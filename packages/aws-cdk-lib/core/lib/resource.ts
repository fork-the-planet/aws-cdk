import { ArnComponents, ArnFormat } from './arn';
import { CfnResource } from './cfn-resource';
import { RESOURCE_SYMBOL } from './constants';
import { ValidationError } from './errors';
import { IStringProducer, Lazy } from './lazy';
import { generatePhysicalName, isGeneratedWhenNeededMarker } from './private/physical-name-generator';
import { Reference } from './reference';
import { RemovalPolicy } from './removal-policy';
import { IResolveContext } from './resolvable';
import { Stack } from './stack';
import { Token, Tokenization } from './token';

// v2 - leave this as a separate section so it reduces merge conflicts when compat is removed
// eslint-disable-next-line import/order
import { Construct, IConstruct } from 'constructs';

/**
 * Represents the environment a given resource lives in.
 * Used as the return value for the `IResource.env` property.
 */
export interface ResourceEnvironment {
  /**
   * The AWS account ID that this resource belongs to.
   * Since this can be a Token
   * (for example, when the account is CloudFormation's AWS::AccountId intrinsic),
   * make sure to use Token.compareStrings()
   * instead of just comparing the values for equality.
   */
  readonly account: string;

  /**
   * The AWS region that this resource belongs to.
   * Since this can be a Token
   * (for example, when the region is CloudFormation's AWS::Region intrinsic),
   * make sure to use Token.compareStrings()
   * instead of just comparing the values for equality.
   */
  readonly region: string;
}

/**
 * Interface for the Resource construct.
 */
export interface IResource extends IConstruct {
  /**
   * The stack in which this resource is defined.
   */
  readonly stack: Stack;

  /**
   * The environment this resource belongs to.
   * For resources that are created and managed by the CDK
   * (generally, those created by creating new class instances like Role, Bucket, etc.),
   * this is always the same as the environment of the stack they belong to;
   * however, for imported resources
   * (those obtained from static methods like fromRoleArn, fromBucketName, etc.),
   * that might be different than the stack they were imported into.
   */
  readonly env: ResourceEnvironment;

  /**
   * Apply the given removal policy to this resource
   *
   * The Removal Policy controls what happens to this resource when it stops
   * being managed by CloudFormation, either because you've removed it from the
   * CDK application or because you've made a change that requires the resource
   * to be replaced.
   *
   * The resource can be deleted (`RemovalPolicy.DESTROY`), or left in your AWS
   * account for data recovery and cleanup later (`RemovalPolicy.RETAIN`).
   */
  applyRemovalPolicy(policy: RemovalPolicy): void;
}

/**
 * Construction properties for `Resource`.
 */
export interface ResourceProps {
  /**
   * The value passed in by users to the physical name prop of the resource.
   *
   * - `undefined` implies that a physical name will be allocated by
   *   CloudFormation during deployment.
   * - a concrete value implies a specific physical name
   * - `PhysicalName.GENERATE_IF_NEEDED` is a marker that indicates that a physical will only be generated
   *   by the CDK if it is needed for cross-environment references. Otherwise, it will be allocated by CloudFormation.
   *
   * @default - The physical name will be allocated by CloudFormation at deployment time
   */
  readonly physicalName?: string;

  /**
   * The AWS account ID this resource belongs to.
   *
   * @default - the resource is in the same account as the stack it belongs to
   */
  readonly account?: string;

  /**
   * The AWS region this resource belongs to.
   *
   * @default - the resource is in the same region as the stack it belongs to
   */
  readonly region?: string;

  /**
   * ARN to deduce region and account from
   *
   * The ARN is parsed and the account and region are taken from the ARN.
   * This should be used for imported resources.
   *
   * Cannot be supplied together with either `account` or `region`.
   *
   * @default - take environment from `account`, `region` parameters, or use Stack environment.
   */
  readonly environmentFromArn?: string;
}

/**
 * A construct which represents an AWS resource.
 */
export abstract class Resource extends Construct implements IResource {
  /**
   * Check whether the given construct is a Resource
   */
  public static isResource(construct: IConstruct): construct is Resource {
    return construct !== null && typeof(construct) === 'object' && RESOURCE_SYMBOL in construct;
  }

  /**
   * Returns true if the construct was created by CDK, and false otherwise
   */
  public static isOwnedResource(construct: IConstruct): boolean {
    return construct.node.defaultChild ? CfnResource.isCfnResource(construct.node.defaultChild) : false;
  }

  public readonly stack: Stack;
  public readonly env: ResourceEnvironment;

  /**
   * Returns a string-encoded token that resolves to the physical name that
   * should be passed to the CloudFormation resource.
   *
   * This value will resolve to one of the following:
   * - a concrete value (e.g. `"my-awesome-bucket"`)
   * - `undefined`, when a name should be generated by CloudFormation
   * - a concrete name generated automatically during synthesis, in
   *   cross-environment scenarios.
   *
   */
  protected readonly physicalName: string;

  private _physicalName: string | undefined;
  private readonly _allowCrossEnvironment: boolean;

  constructor(scope: Construct, id: string, props: ResourceProps = {}) {
    super(scope, id);

    if ((props.account !== undefined || props.region !== undefined) && props.environmentFromArn !== undefined) {
      throw new ValidationError(`Supply at most one of 'account'/'region' (${props.account}/${props.region}) and 'environmentFromArn' (${props.environmentFromArn})`, this);
    }

    Object.defineProperty(this, RESOURCE_SYMBOL, { value: true });

    this.stack = Stack.of(this);

    const parsedArn = props.environmentFromArn ?
      // Since we only want the region and account, NO_RESOURCE_NAME is good enough
      this.stack.splitArn(props.environmentFromArn, ArnFormat.NO_RESOURCE_NAME)
      : undefined;
    this.env = {
      account: props.account ?? parsedArn?.account ?? this.stack.account,
      region: props.region ?? parsedArn?.region ?? this.stack.region,
    };

    let physicalName = props.physicalName;

    if (props.physicalName && isGeneratedWhenNeededMarker(props.physicalName)) {
      // auto-generate only if cross-env is required
      this._physicalName = undefined;
      this._allowCrossEnvironment = true;
      physicalName = Lazy.string({ produce: () => this._physicalName });
    } else if (props.physicalName && !Token.isUnresolved(props.physicalName)) {
      // concrete value specified by the user
      this._physicalName = props.physicalName;
      this._allowCrossEnvironment = true;
    } else {
      // either undefined (deploy-time) or has tokens, which means we can't use for cross-env
      this._physicalName = props.physicalName;
      this._allowCrossEnvironment = false;
    }

    if (physicalName === undefined) {
      physicalName = Token.asString(undefined);
    }

    this.physicalName = physicalName;
  }

  /**
   * Called when this resource is referenced across environments
   * (account/region) to order to request that a physical name will be generated
   * for this resource during synthesis, so the resource can be referenced
   * through its absolute name/arn.
   *
   * @internal
   */
  public _enableCrossEnvironment(): void {
    if (!this._allowCrossEnvironment) {
      // error out - a deploy-time name cannot be used across environments
      throw new ValidationError(`Cannot use resource '${this.node.path}' in a cross-environment fashion, ` +
        "the resource's physical name must be explicit set or use `PhysicalName.GENERATE_IF_NEEDED`", this);
    }

    if (!this._physicalName) {
      this._physicalName = this.generatePhysicalName();
    }
  }

  /**
   * Apply the given removal policy to this resource
   *
   * The Removal Policy controls what happens to this resource when it stops
   * being managed by CloudFormation, either because you've removed it from the
   * CDK application or because you've made a change that requires the resource
   * to be replaced.
   *
   * The resource can be deleted (`RemovalPolicy.DESTROY`), or left in your AWS
   * account for data recovery and cleanup later (`RemovalPolicy.RETAIN`).
   */
  public applyRemovalPolicy(policy: RemovalPolicy) {
    const child = this.node.defaultChild;
    if (!child || !CfnResource.isCfnResource(child)) {
      throw new ValidationError('Cannot apply RemovalPolicy: no child or not a CfnResource. Apply the removal policy on the CfnResource directly.', this);
    }
    child.applyRemovalPolicy(policy);
  }

  protected generatePhysicalName(): string {
    return generatePhysicalName(this);
  }

  /**
   * Returns an environment-sensitive token that should be used for the
   * resource's "name" attribute (e.g. `bucket.bucketName`).
   *
   * Normally, this token will resolve to `nameAttr`, but if the resource is
   * referenced across environments, it will be resolved to `this.physicalName`,
   * which will be a concrete name.
   *
   * @param nameAttr The CFN attribute which resolves to the resource's name.
   * Commonly this is the resource's `ref`.
   */
  protected getResourceNameAttribute(nameAttr: string) {
    return mimicReference(nameAttr, {
      produce: (context: IResolveContext) => {
        const consumingStack = Stack.of(context.scope);

        if (this.stack.account !== consumingStack.account ||
          (this.stack.region !== consumingStack.region &&
            !consumingStack._crossRegionReferences)) {
          this._enableCrossEnvironment();
          return this.physicalName;
        } else {
          return nameAttr;
        }
      },
    });
  }

  /**
   * Returns an environment-sensitive token that should be used for the
   * resource's "ARN" attribute (e.g. `bucket.bucketArn`).
   *
   * Normally, this token will resolve to `arnAttr`, but if the resource is
   * referenced across environments, `arnComponents` will be used to synthesize
   * a concrete ARN with the resource's physical name. Make sure to reference
   * `this.physicalName` in `arnComponents`.
   *
   * @param arnAttr The CFN attribute which resolves to the ARN of the resource.
   * Commonly it will be called "Arn" (e.g. `resource.attrArn`), but sometimes
   * it's the CFN resource's `ref`.
   * @param arnComponents The format of the ARN of this resource. You must
   * reference `this.physicalName` somewhere within the ARN in order for
   * cross-environment references to work.
   *
   */
  protected getResourceArnAttribute(arnAttr: string, arnComponents: ArnComponents) {
    return mimicReference(arnAttr, {
      produce: (context: IResolveContext) => {
        const consumingStack = Stack.of(context.scope);
        if (this.stack.account !== consumingStack.account ||
          (this.stack.region !== consumingStack.region &&
            !consumingStack._crossRegionReferences)) {
          this._enableCrossEnvironment();
          return this.stack.formatArn(arnComponents);
        } else {
          return arnAttr;
        }
      },
    });
  }
}

/**
 * Produce a Lazy that is also a Reference (if the base value is a Reference).
 *
 * If the given value is a Reference (or resolves to a Reference), return a new
 * Reference that mimics the same target and display name, but resolves using
 * the logic of the passed lazy.
 *
 * If the given value is NOT a Reference, just return a simple Lazy.
 */
function mimicReference(refSource: any, producer: IStringProducer): string {
  const reference = Tokenization.reverse(refSource, {
    // If this is an ARN concatenation, just fail to extract a reference.
    failConcat: false,
  });
  if (!Reference.isReference(reference)) {
    return Lazy.uncachedString(producer);
  }

  return Token.asString(new class extends Reference {
    public resolve(context: IResolveContext) {
      return producer.produce(context);
    }
  }(reference, reference.target, reference.displayName));
}
