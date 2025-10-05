# AWS Deployment Guide for Onshape MCP Server

This guide explains how to deploy the Onshape MCP server to AWS using the AWS MCP deployment guidance.

## Architecture

The deployment uses:
- **CloudFront** for global content delivery with WAF protection
- **Application Load Balancer** for traffic distribution and SSL termination
- **ECS Fargate** for containerized Onshape MCP server
- **AWS Cognito** for OAuth 2.0 authentication
- **StreamableHTTP transport** with stateless request handling

## Prerequisites

### Required Tools

1. [AWS CLI](https://aws.amazon.com/cli/) installed and configured
2. [Node.js](https://nodejs.org/) v14 or later
3. [AWS CDK](https://aws.amazon.com/cdk/) installed:
   ```bash
   npm install -g aws-cdk
   ```
4. Docker installed and running

### AWS Account Setup

If you're using AWS CDK for the first time, bootstrap your account:

```bash
cdk bootstrap
```

### Onshape API Credentials

You need Onshape API credentials:
1. Go to https://dev-portal.onshape.com
2. Create API keys (Access Key and Secret Key)
3. Save these credentials - you'll need them for deployment

## Deployment Steps

### 1. Install Dependencies

```bash
# Install root project dependencies
npm install

# Install CDK dependencies
cd cdk
npm install
```

### 2. Set Environment Variables

```bash
# Onshape API credentials (required for deployment)
export ONSHAPE_ACCESS_KEY="your_access_key"
export ONSHAPE_SECRET_KEY="your_secret_key"
export ONSHAPE_API_URL="https://cad.onshape.com/api/v12"  # Optional
```

### 3. Login to AWS ECR

```bash
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
```

### 4. Deploy to AWS

From the `cdk` directory:

#### Basic Deployment (HTTP only)

```bash
cd cdk
cdk deploy --all
```

#### Deployment with Custom Domain (HTTPS)

For single region (us-east-1):
```bash
cdk deploy --all \
  --context cdnCertificateArn=arn:aws:acm:us-east-1:123456789012:certificate/abc123 \
  --context albCertificateArn=arn:aws:acm:us-east-1:123456789012:certificate/abc123 \
  --context customDomain=mcp.example.com
```

For multi-region:
```bash
cdk deploy --all \
  --context cdnCertificateArn=arn:aws:acm:us-east-1:123456789012:certificate/abc123 \
  --context albCertificateArn=arn:aws:acm:eu-west-1:123456789012:certificate/def456 \
  --context customDomain=mcp.example.com
```

**Note:** CloudFront certificates must be in `us-east-1`.

### 5. Deployment Validation

1. **Check CloudFormation stacks:**
   - Open AWS CloudFormation console
   - Verify all stacks show "CREATE_COMPLETE"

2. **Verify Cognito setup:**
   - Open Amazon Cognito console
   - Verify User Pool creation
   - Confirm App Client configuration

3. **Verify infrastructure:**
   - CloudFront distribution is "Deployed"
   - Application Load Balancer is "Active"
   - ECS service is running

### 6. Get Deployment URLs

After deployment completes, the CDK will output important URLs:

- **MCP Server Endpoint:** `https://<cloudfront-domain>/onshape/mcp`
- **OAuth Metadata:** `https://<cloudfront-domain>/onshape/.well-known/oauth-protected-resource`
- **Health Check:** `https://<cloudfront-domain>/onshape/`

## Testing the Deployment

### Create Test User

For development and testing:

```bash
# Create test user
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username test@example.com

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id YOUR_USER_POOL_ID \
  --username test@example.com \
  --password "TestPass123!" \
  --permanent
```

### Test Health Endpoint

```bash
curl https://<cloudfront-endpoint>/onshape/
```

Expected response:
```json
{
  "status": "healthy",
  "service": "onshape-mcp"
}
```

## Updating the Deployment

### Update Only the MCP Server

If you only changed the MCP server code:

```bash
cd cdk
cdk deploy MCP-Server
```

### Update All Stacks

```bash
cd cdk
cdk deploy --all
```

## Environment Variables

The following environment variables are configured in the CDK stack:

| Variable | Description | Required |
|----------|-------------|----------|
| `ONSHAPE_ACCESS_KEY` | Onshape API access key | Yes |
| `ONSHAPE_SECRET_KEY` | Onshape API secret key | Yes |
| `ONSHAPE_API_URL` | Onshape API base URL | No (defaults to v12) |
| `PORT` | Server port | No (defaults to 8080) |
| `AWS_REGION` | AWS region | Auto-set |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID | Auto-set |
| `COGNITO_CLIENT_ID` | Cognito Client ID | Auto-set |

## Cost Estimation

Estimated monthly cost for running this deployment in US East (N. Virginia):

| Service | Cost |
|---------|------|
| VPC (NAT Gateway) | ~$37 |
| Application Load Balancer | ~$17 |
| CloudFront | ~$88 |
| WAF | ~$10 |
| ECS Fargate (1 task) | ~$36 |
| Other (Secrets, Lambda) | ~$1 |
| **Total** | **~$189/month** |

## Security Best Practices

1. **Never commit credentials:**
   - Add `.env` to `.gitignore`
   - Use AWS Secrets Manager for production

2. **Enable MFA:**
   - Enable MFA in Cognito for production users

3. **Monitor access:**
   - Set up CloudWatch alarms
   - Review CloudFront access logs

4. **Update regularly:**
   - Keep dependencies up to date
   - Monitor security advisories

## Troubleshooting

### Build Failures

**Issue:** Docker build fails
```bash
# Ensure Docker is running
docker ps

# Clear Docker cache if needed
docker system prune -a
```

**Issue:** CDK deployment fails
```bash
# Check AWS credentials
aws sts get-caller-identity

# Re-bootstrap if needed
cdk bootstrap
```

### Runtime Issues

**Issue:** Health check fails
- Check ECS task logs in CloudWatch
- Verify environment variables are set correctly
- Ensure Onshape API credentials are valid

**Issue:** Authentication fails
- Verify Cognito User Pool configuration
- Check that OAuth metadata endpoint is accessible
- Confirm user credentials are correct

### Onshape API Errors

- Verify API keys at https://dev-portal.onshape.com
- Check API key permissions
- Monitor rate limits

## Cleanup

To remove all deployed resources:

```bash
cd cdk
cdk destroy --all
```

Manual cleanup steps:
- Empty any created S3 buckets
- Delete CloudWatch log groups (if needed)
- Remove Cognito User Pool (if not needed)

## Integration with MCP Clients

Once deployed, you can connect to the server using any MCP client that supports:
- OAuth 2.0 Protected Resource Metadata (RFC9728)
- StreamableHTTP transport

### Connection Details

- **Server URL:** `https://<your-cloudfront-endpoint>/onshape/mcp`
- **OAuth Metadata:** `https://<your-cloudfront-endpoint>/onshape/.well-known/oauth-protected-resource`
- **Authentication:** OAuth 2.0 (AWS Cognito)

### Available Tools

The server provides the following MCP tool:

#### `import_stl`

Creates an Onshape document from an ASCII STL string.

**Parameters:**
- `stl` (required): ASCII STL content
- `documentName` (optional): Name for the document
- `filename` (optional): Filename for the STL (default: "model.stl")
- `createNewPartStudio` (optional): Create a new Part Studio (default: false)

## Next Steps

1. **Add more tools:** Extend the MCP server with additional Onshape API integrations
2. **Set up monitoring:** Configure CloudWatch dashboards and alarms
3. **Enable auto-scaling:** Configure ECS service auto-scaling based on load
4. **Add CI/CD:** Set up automated deployments with GitHub Actions or AWS CodePipeline

## Support

For issues specific to:
- **AWS deployment:** See the [AWS MCP Guidance](https://github.com/aws-solutions-library-samples/guidance-for-deploying-model-context-protocol-servers-on-aws)
- **Onshape API:** Check [Onshape API docs](https://dev-portal.onshape.com)
- **MCP Protocol:** See [MCP specification](https://modelcontextprotocol.io)

## License

MIT
