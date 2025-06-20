import { Template } from 'aws-cdk-lib/assertions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SecretValue, Stack } from 'aws-cdk-lib';
import * as amplify from '../lib';

let stack: Stack;
beforeEach(() => {
  stack = new Stack();
});

test('create an app connected to a GitHub repository', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    buildSpec: codebuild.BuildSpec.fromObjectToYaml({
      version: '1.0',
      frontend: {
        phases: {
          build: {
            commands: [
              'npm run build',
            ],
          },
        },
      },
    }),
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    Name: 'App',
    BuildSpec: 'version: \"1.0\"\nfrontend:\n  phases:\n    build:\n      commands:\n        - npm run build\n',
    IAMServiceRole: {
      'Fn::GetAtt': [
        'AppRole1AF9B530',
        'Arn',
      ],
    },
    OauthToken: 'secret',
    Repository: 'https://github.com/aws/aws-cdk',
    BasicAuthConfig: {
      EnableBasicAuth: false,
    },
  });

  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 'amplify.amazonaws.com',
          },
        },
      ],
      Version: '2012-10-17',
    },
  });
});

test('create an app connected to a GitLab repository', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitLabSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    buildSpec: codebuild.BuildSpec.fromObject({
      version: '1.0',
      frontend: {
        phases: {
          build: {
            commands: [
              'npm run build',
            ],
          },
        },
      },
    }),
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    Name: 'App',
    BuildSpec: '{\n  \"version\": \"1.0\",\n  \"frontend\": {\n    \"phases\": {\n      \"build\": {\n        \"commands\": [\n          \"npm run build\"\n        ]\n      }\n    }\n  }\n}',
    IAMServiceRole: {
      'Fn::GetAtt': [
        'AppRole1AF9B530',
        'Arn',
      ],
    },
    OauthToken: 'secret',
    Repository: 'https://gitlab.com/aws/aws-cdk',
  });

  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 'amplify.amazonaws.com',
          },
        },
      ],
      Version: '2012-10-17',
    },
  });
});

test('create an app connected to a CodeCommit repository', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.CodeCommitSourceCodeProvider({
      repository: codecommit.Repository.fromRepositoryName(stack, 'Repo', 'my-repo'),
    }),
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    IAMServiceRole: {
      'Fn::GetAtt': [
        'AppRole1AF9B530',
        'Arn',
      ],
    },
    Repository: {
      'Fn::Join': [
        '',
        [
          'https://git-codecommit.',
          {
            Ref: 'AWS::Region',
          },
          '.',
          {
            Ref: 'AWS::URLSuffix',
          },
          '/v1/repos/my-repo',
        ],
      ],
    },
  });

  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: [
        {
          Action: 'codecommit:GitPull',
          Effect: 'Allow',
          Resource: {
            'Fn::Join': [
              '',
              [
                'arn:',
                {
                  Ref: 'AWS::Partition',
                },
                ':codecommit:',
                {
                  Ref: 'AWS::Region',
                },
                ':',
                {
                  Ref: 'AWS::AccountId',
                },
                ':my-repo',
              ],
            ],
          },
        },
      ],
      Version: '2012-10-17',
    },
    Roles: [
      {
        Ref: 'AppRole1AF9B530',
      },
    ],
  });
});

test('with basic auth from credentials', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    basicAuth: amplify.BasicAuth.fromCredentials('username', SecretValue.unsafePlainText('password')),
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    BasicAuthConfig: {
      EnableBasicAuth: true,
      Password: 'password',
      Username: 'username',
    },
  });
});

test('with basic auth from generated password', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    basicAuth: amplify.BasicAuth.fromGeneratedPassword('username'),
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    BasicAuthConfig: {
      EnableBasicAuth: true,
      Password: {
        'Fn::Join': [
          '',
          [
            '{{resolve:secretsmanager:',
            {
              Ref: 'AppAppBasicAuthE743F015',
            },
            ':SecretString:password::}}',
          ],
        ],
      },
      Username: 'username',
    },
  });

  Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::Secret', {
    GenerateSecretString: {
      GenerateStringKey: 'password',
      SecretStringTemplate: '{\"username\":\"username\"}',
    },
  });
});

test('with env vars', () => {
  // WHEN
  const app = new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    environmentVariables: {
      key1: 'value1',
    },
  });
  app.addEnvironment('key2', 'value2');

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    EnvironmentVariables: [
      {
        Name: 'key1',
        Value: 'value1',
      },
      {
        Name: 'key2',
        Value: 'value2',
      },
    ],
  });
});

test('with custom rules', () => {
  // WHEN
  const app = new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    customRules: [
      {
        source: '/source1',
        target: '/target1',
        status: amplify.RedirectStatus.PERMANENT_REDIRECT,
      },
    ],
  });
  app.addCustomRule({
    source: '/source2',
    target: '/target2',
    status: amplify.RedirectStatus.TEMPORARY_REDIRECT,
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    CustomRules: [
      {
        Source: '/source1',
        Status: '301',
        Target: '/target1',
      },
      {
        Source: '/source2',
        Status: '302',
        Target: '/target2',
      },
    ],
  });
});

test('with SPA redirect', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    customRules: [amplify.CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT],
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    CustomRules: [
      {
        Source: '</^[^.]+$/>',
        Status: '200',
        Target: '/index.html',
      },
    ],
  });
});

test('with auto branch creation', () => {
  // WHEN
  const app = new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    autoBranchCreation: {
      environmentVariables: {
        key1: 'value1',
      },
    },
  });
  app.addAutoBranchEnvironment('key2', 'value2');

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    AutoBranchCreationConfig: {
      BasicAuthConfig: {
        EnableBasicAuth: false,
      },
      EnableAutoBranchCreation: true,
      EnableAutoBuild: true,
      EnablePullRequestPreview: true,
      EnvironmentVariables: [
        {
          Name: 'key1',
          Value: 'value1',
        },
        {
          Name: 'key2',
          Value: 'value2',
        },
      ],
    },
  });
});

test('with auto branch deletion', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    autoBranchDeletion: true,
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    EnableBranchAutoDeletion: true,
  });
});

test('with custom headers', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    customResponseHeaders: [
      {
        pattern: '*.json',
        headers: {
          'custom-header-name-1': 'custom-header-value-1',
          'custom-header-name-2': 'custom-header-value-2',
        },
      },
      {
        pattern: '/path/*',
        headers: {
          'custom-header-name-1': 'custom-header-value-2',
        },
      },
      {
        pattern: '/with-tokens/*',
        headers: {
          'x-custom': `${'hello'.repeat(10)}${Stack.of(stack).urlSuffix} `,
        },
      },
    ],
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    CustomHeaders: {
      'Fn::Join': [
        '',
        [
          'customHeaders:\n  - pattern: "*.json"\n    headers:\n      - key: "custom-header-name-1"\n        value: "custom-header-value-1"\n      - key: "custom-header-name-2"\n        value: "custom-header-value-2"\n  - pattern: "/path/*"\n    headers:\n      - key: "custom-header-name-1"\n        value: "custom-header-value-2"\n  - pattern: "/with-tokens/*"\n    headers:\n      - key: "x-custom"\n        value: "hellohellohellohellohellohellohellohellohellohello',
          {
            Ref: 'AWS::URLSuffix',
          },
          ' "\n',
        ],
      ],
    },
  });
});

test('with custom headers in a monorepo structure', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
      owner: 'aws',
      repository: 'aws-cdk',
      oauthToken: SecretValue.unsafePlainText('secret'),
    }),
    buildSpec: codebuild.BuildSpec.fromObjectToYaml({
      version: '1.0',
      applications: [
        {
          appRoot: 'frontend',
          frontend: {
            phases: {
              preBuild: {
                commands: ['npm install'],
              },
              build: {
                commands: ['npm run build'],
              },
            },
          },
        },
        {
          appRoot: 'backend',
          backend: {
            phases: {
              preBuild: {
                commands: ['npm install'],
              },
              build: {
                commands: ['npm run build'],
              },
            },
          },
        },
      ],
    }),
    customResponseHeaders: [
      {
        appRoot: 'frontend',
        pattern: '*.json',
        headers: {
          'custom-header-name-1': 'custom-header-value-1',
          'custom-header-name-2': 'custom-header-value-2',
        },
      },
      {
        appRoot: 'backend',
        pattern: '/path/*',
        headers: {
          'custom-header-name-1': 'custom-header-value-2',
          'x-aws-url-suffix': `this-is-the-suffix-${stack.urlSuffix}`,
        },
      },
    ],
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    CustomHeaders: {
      'Fn::Join': [
        '',
        [
          'applications:\n  - appRoot: frontend\n    customHeaders:\n      - pattern: "*.json"\n        headers:\n          - key: "custom-header-name-1"\n            value: "custom-header-value-1"\n          - key: "custom-header-name-2"\n            value: "custom-header-value-2"\n  - appRoot: backend\n    customHeaders:\n      - pattern: "/path/*"\n        headers:\n          - key: "custom-header-name-1"\n            value: "custom-header-value-2"\n          - key: "x-aws-url-suffix"\n            value: "this-is-the-suffix-',
          {
            Ref: 'AWS::URLSuffix',
          },
          '"\n',
        ],
      ],
    },
  });
});

test('error with inconsistent appRoot in custom headers', () => {
  // WHEN
  expect(() => {
    new amplify.App(stack, 'App', {
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: 'aws',
        repository: 'aws-cdk',
        oauthToken: SecretValue.unsafePlainText('secret'),
      }),
      customResponseHeaders: [
        {
          pattern: '*.json',
          headers: {
            'custom-header-name-1': 'custom-header-value-1',
            'custom-header-name-2': 'custom-header-value-2',
          },
        },
        {
          appRoot: 'backend',
          pattern: '/path/*',
          headers: {
            'custom-header-name-1': 'custom-header-value-2',
          },
        },
      ],
    });
  }).toThrow('appRoot must be either be present or absent across all custom response headers');
});

test('create a statically hosted app by default', () => {
  // WHEN
  new amplify.App(stack, 'App', {});

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    Platform: amplify.Platform.WEB,
  });
});

test('create a dynamically rendered app when the platform is set to WEB_COMPUTE', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    platform: amplify.Platform.WEB_COMPUTE,
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    Platform: amplify.Platform.WEB_COMPUTE,
  });
});

test.each([amplify.CacheConfigType.AMPLIFY_MANAGED, amplify.CacheConfigType.AMPLIFY_MANAGED_NO_COOKIES])('create a app with cacheConfigType is set to %s', (cacheConfigType) => {
  // WHEN
  new amplify.App(stack, 'App', {
    cacheConfigType,
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    CacheConfig: {
      Type: cacheConfigType,
    },
  });
});

test('create a SSR app with auto-generate compute role', () => {
  // WHEN
  new amplify.App(stack, 'App', {
    platform: amplify.Platform.WEB_COMPUTE,
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    Platform: amplify.Platform.WEB_COMPUTE,
    ComputeRoleArn: {
      'Fn::GetAtt': ['AppComputeRole426920E4', 'Arn'],
    },
  });

  Template.fromStack(stack).resourceCountIs('AWS::IAM::Role', 2);
});

test('create a SSR app with compute role', () => {
  // WHEN
  const computeRole = new iam.Role(stack, 'ComputeRole', {
    assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
  });

  new amplify.App(stack, 'App', {
    platform: amplify.Platform.WEB_COMPUTE,
    computeRole,
  });

  // THEN
  Template.fromStack(stack).hasResourceProperties('AWS::Amplify::App', {
    Platform: amplify.Platform.WEB_COMPUTE,
    ComputeRoleArn: stack.resolve(computeRole.roleArn),
  });
});

test('throws when compute role is set with a non SSR app', () => {
  // WHEN
  const computeRole = new iam.Role(stack, 'ComputeRole', {
    assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
  });

  expect(() => {
    new amplify.App(stack, 'App', {
      platform: amplify.Platform.WEB,
      computeRole,
    });
  }).toThrow('`computeRole` can only be specified for `Platform.WEB_COMPUTE` or `Platform.WEB_DYNAMIC`.');
});
