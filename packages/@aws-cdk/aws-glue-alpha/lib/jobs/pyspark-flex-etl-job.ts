import { CfnJob } from 'aws-cdk-lib/aws-glue';
import { Construct } from 'constructs';
import { JobType, GlueVersion, JobLanguage, PythonVersion, WorkerType, ExecutionClass } from '../constants';
import * as cdk from 'aws-cdk-lib/core';
import { Code } from '../code';
import { SparkJob, SparkJobProps } from './spark-job';
import { addConstructMetadata } from 'aws-cdk-lib/core/lib/metadata-resource';
import { propertyInjectable } from 'aws-cdk-lib/core/lib/prop-injectable';

/**
 * Properties for PySparkFlexEtlJob
 */
export interface PySparkFlexEtlJobProps extends SparkJobProps {
  /**
   * Specifies configuration properties of a notification (optional).
   * After a job run starts, the number of minutes to wait before sending a job run delay notification.
   * @default - undefined
   */
  readonly notifyDelayAfter?: cdk.Duration;

  /**
   * Extra Python Files S3 URL (optional)
   * S3 URL where additional python dependencies are located
   *
   * @default - no extra files
   */
  readonly extraPythonFiles?: Code[];

  /**
   * Additional files, such as configuration files that AWS Glue copies to the working directory of your script before executing it.
   *
   * @default - no extra files specified.
   *
   * @see https://docs.aws.amazon.com/glue/latest/dg/aws-glue-programming-etl-glue-arguments.html
   */
  readonly extraFiles?: Code[];

  /**
   * Extra Jars S3 URL (optional)
   * S3 URL where additional jar dependencies are located
   * @default - no extra jar files
   */
  readonly extraJars?: Code[];

  /**
   * Setting this value to true prioritizes the customer's extra JAR files in the classpath.
   *
   * @default false - priority is not given to user-provided jars
   *
   * @see `--user-jars-first` in https://docs.aws.amazon.com/glue/latest/dg/aws-glue-programming-etl-glue-arguments.html
   */
  readonly extraJarsFirst?: boolean;
}

/**
 * Flex Jobs class
 *
 * Flex jobs supports Python and Scala language.
 * The flexible execution class is appropriate for non-urgent jobs such as
 * pre-production jobs, testing, and one-time data loads.
 * Flexible job runs are supported for jobs using AWS Glue version 3.0 or later and G.1X or
 * G.2X worker types but will default to the latest version of Glue (currently Glue 3.0.)
 *
 * Similar to ETL, we’ll enable these features: —enable-metrics, —enable-spark-ui,
 * —enable-continuous-cloudwatch-log
 */
@propertyInjectable
export class PySparkFlexEtlJob extends SparkJob {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = '@aws-cdk.aws-glue-alpha.PySparkFlexEtlJob';
  public readonly jobArn: string;
  public readonly jobName: string;

  /**
   * PySparkFlexEtlJob constructor
   */
  constructor(scope: Construct, id: string, props: PySparkFlexEtlJobProps) {
    super(scope, id, props);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    // Combine command line arguments into a single line item
    const defaultArguments = {
      ...this.executableArguments(props),
      ...this.nonExecutableCommonArguments(props),
    };

    const jobResource = new CfnJob(this, 'Resource', {
      name: props.jobName,
      description: props.description,
      role: this.role.roleArn,
      command: {
        name: JobType.ETL,
        scriptLocation: this.codeS3ObjectUrl(props.script),
        pythonVersion: PythonVersion.THREE,
      },
      glueVersion: props.glueVersion ? props.glueVersion : GlueVersion.V3_0,
      workerType: props.workerType ? props.workerType : WorkerType.G_1X,
      numberOfWorkers: props.numberOfWorkers ? props.numberOfWorkers : 10,
      maxRetries: props.maxRetries,
      executionProperty: props.maxConcurrentRuns ? { maxConcurrentRuns: props.maxConcurrentRuns } : undefined,
      notificationProperty: props.notifyDelayAfter ? { notifyDelayAfter: props.notifyDelayAfter.toMinutes() } : undefined,
      timeout: props.timeout?.toMinutes(),
      connections: props.connections ? { connections: props.connections.map((connection) => connection.connectionName) } : undefined,
      securityConfiguration: props.securityConfiguration?.securityConfigurationName,
      tags: props.tags,
      executionClass: ExecutionClass.FLEX,
      jobRunQueuingEnabled: false,
      defaultArguments,

    });

    const resourceName = this.getResourceNameAttribute(jobResource.ref);
    this.jobArn = this.buildJobArn(this, resourceName);
    this.jobName = resourceName;
  }

  /**
   *Set the executable arguments with best practices enabled by default
   *
   * @returns An array of arguments for Glue to use on execution
   */
  private executableArguments(props: PySparkFlexEtlJobProps) {
    const args: { [key: string]: string } = {};
    args['--job-language'] = JobLanguage.PYTHON;
    this.setupExtraCodeArguments(args, props);
    return args;
  }
}
