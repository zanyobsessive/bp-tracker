#!/bin/bash
# BP-Tracker AWS Deployment Script
# This script sets up DynamoDB, Lambda, and API Gateway for the feeding log

set -e

REGION="us-east-1"
TABLE_NAME="bp-feeding-history"
LAMBDA_NAME="bp-feeding-api"
ROLE_NAME="bp-feeding-lambda-role"
API_NAME="bp-feeding-api"

echo "=== BP-Tracker AWS Backend Deployment ==="
echo ""

# Step 1: Create DynamoDB Table
echo "Step 1: Creating DynamoDB table..."
aws dynamodb create-table \
  --table-name $TABLE_NAME \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION \
  2>/dev/null || echo "Table may already exist, continuing..."

echo "Waiting for table to be active..."
aws dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION

# Step 2: Create IAM Role for Lambda
echo ""
echo "Step 2: Creating IAM role for Lambda..."
aws iam create-role \
  --role-name $ROLE_NAME \
  --assume-role-policy-document file://lambda-trust-policy.json \
  2>/dev/null || echo "Role may already exist, continuing..."

# Attach the policy
aws iam put-role-policy \
  --role-name $ROLE_NAME \
  --policy-name bp-feeding-dynamodb-policy \
  --policy-document file://lambda-role-policy.json

# Get the role ARN
ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)
echo "Role ARN: $ROLE_ARN"

# Wait for role to propagate
echo "Waiting for IAM role to propagate..."
sleep 10

# Step 3: Package and create Lambda function
echo ""
echo "Step 3: Creating Lambda function..."
cd lambda
npm install --production
zip -r ../lambda-package.zip .
cd ..

aws lambda create-function \
  --function-name $LAMBDA_NAME \
  --runtime nodejs18.x \
  --role $ROLE_ARN \
  --handler index.handler \
  --zip-file fileb://lambda-package.zip \
  --environment "Variables={TABLE_NAME=$TABLE_NAME}" \
  --timeout 10 \
  --region $REGION \
  2>/dev/null || {
    echo "Lambda exists, updating code..."
    aws lambda update-function-code \
      --function-name $LAMBDA_NAME \
      --zip-file fileb://lambda-package.zip \
      --region $REGION
  }

LAMBDA_ARN=$(aws lambda get-function --function-name $LAMBDA_NAME --region $REGION --query 'Configuration.FunctionArn' --output text)
echo "Lambda ARN: $LAMBDA_ARN"

# Step 4: Create HTTP API Gateway
echo ""
echo "Step 4: Creating API Gateway..."

# Create the HTTP API
API_ID=$(aws apigatewayv2 create-api \
  --name $API_NAME \
  --protocol-type HTTP \
  --cors-configuration AllowOrigins="*",AllowMethods="GET,POST,DELETE,OPTIONS",AllowHeaders="Content-Type" \
  --region $REGION \
  --query 'ApiId' --output text 2>/dev/null) || {
    # API might exist, try to find it
    API_ID=$(aws apigatewayv2 get-apis --region $REGION --query "Items[?Name=='$API_NAME'].ApiId" --output text)
  }

echo "API ID: $API_ID"

# Create Lambda integration
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id $API_ID \
  --integration-type AWS_PROXY \
  --integration-uri $LAMBDA_ARN \
  --payload-format-version 2.0 \
  --region $REGION \
  --query 'IntegrationId' --output text 2>/dev/null) || {
    INTEGRATION_ID=$(aws apigatewayv2 get-integrations --api-id $API_ID --region $REGION --query 'Items[0].IntegrationId' --output text)
  }

echo "Integration ID: $INTEGRATION_ID"

# Create routes
echo "Creating routes..."
aws apigatewayv2 create-route --api-id $API_ID --route-key "GET /feeding" --target "integrations/$INTEGRATION_ID" --region $REGION 2>/dev/null || true
aws apigatewayv2 create-route --api-id $API_ID --route-key "POST /feeding" --target "integrations/$INTEGRATION_ID" --region $REGION 2>/dev/null || true
aws apigatewayv2 create-route --api-id $API_ID --route-key "DELETE /feeding" --target "integrations/$INTEGRATION_ID" --region $REGION 2>/dev/null || true
aws apigatewayv2 create-route --api-id $API_ID --route-key "DELETE /feeding/{id}" --target "integrations/$INTEGRATION_ID" --region $REGION 2>/dev/null || true

# Create default stage with auto-deploy
aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name prod \
  --auto-deploy \
  --region $REGION 2>/dev/null || true

# Add Lambda permission for API Gateway
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws lambda add-permission \
  --function-name $LAMBDA_NAME \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*" \
  --region $REGION 2>/dev/null || true

# Get the API endpoint
API_ENDPOINT="https://$API_ID.execute-api.$REGION.amazonaws.com/prod"

echo ""
echo "=== Deployment Complete! ==="
echo ""
echo "API Endpoint: $API_ENDPOINT"
echo ""
echo "Next steps:"
echo "1. Update the API_BASE_URL in public/js/feeding.js to:"
echo "   const API_BASE_URL = '$API_ENDPOINT';"
echo ""
echo "2. Re-upload your static files to S3:"
echo "   aws s3 sync public/ s3://zanestiles.com/ --delete"
echo ""
echo "3. Invalidate CloudFront cache (if needed):"
echo "   aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths '/*'"
