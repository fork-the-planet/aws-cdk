import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Stack } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { Bundling } from './bundling';
import { BundlingOptions } from './types';
import { addConstructMetadata } from 'aws-cdk-lib/core/lib/metadata-resource';
import { propertyInjectable } from 'aws-cdk-lib/core/lib/prop-injectable';

/**
 * Properties for PythonLayerVersion
 */
export interface PythonLayerVersionProps extends lambda.LayerVersionOptions {
  /**
   * The path to the root directory of the lambda layer.
   */
  readonly entry: string;

  /**
   * The runtimes compatible with the python layer.
   *
   * @default - Only Python 3.7 is supported.
   */
  readonly compatibleRuntimes?: lambda.Runtime[];

  /**
   * The system architectures compatible with this layer.
   * @default [Architecture.X86_64]
   */
  readonly compatibleArchitectures?: lambda.Architecture[];
  /**
   * Bundling options to use for this function. Use this to specify custom bundling options like
   * the bundling Docker image, asset hash type, custom hash, architecture, etc.
   *
   * @default - Use the default bundling Docker image, with x86_64 architecture.
   */
  readonly bundling?: BundlingOptions;
}

/**
 * A lambda layer version.
 *
 */
@propertyInjectable
export class PythonLayerVersion extends lambda.LayerVersion {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = '@aws-cdk.aws-lambda-python-alpha.PythonLayerVersion';

  constructor(scope: Construct, id: string, props: PythonLayerVersionProps) {
    const compatibleRuntimes = props.compatibleRuntimes ?? [lambda.Runtime.PYTHON_3_7];
    const compatibleArchitectures = props.compatibleArchitectures ?? [lambda.Architecture.X86_64];

    // Ensure that all compatible runtimes are python
    for (const runtime of compatibleRuntimes) {
      if (runtime && runtime.family !== lambda.RuntimeFamily.PYTHON) {
        throw new Error('Only `PYTHON` runtimes are supported.');
      }
    }

    // Entry and defaults
    const entry = path.resolve(props.entry);
    // Pick the first compatibleRuntime and compatibleArchitectures to use for bundling
    const runtime = compatibleRuntimes[0];
    const architecture = compatibleArchitectures[0];

    super(scope, id, {
      ...props,
      compatibleRuntimes,
      code: Bundling.bundle({
        entry,
        runtime,
        architecture,
        outputPathSuffix: 'python',
        skip: !Stack.of(scope).bundlingRequired,
        ...props.bundling,
      }),
    });

    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);
  }
}
