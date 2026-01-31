import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME || 'bp-feeding-history';
const SNAPSHOT_BUCKET = process.env.SNAPSHOT_BUCKET || 'zanestiles.com';
const SNAPSHOT_KEY = 'snapshots/current.jpg';
const SNAPSHOT_META_KEY = 'snapshots/meta.json';
const PARTITION_KEY = 'FEEDING_LOG'; // Single partition for all feeding records

// Password for protected endpoints - stored in environment variable
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'zane is smart';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Helper to check authentication
function checkAuth(event) {
  // Check Authorization header first
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (authHeader) {
    // Support "Bearer <password>" or just "<password>"
    const password = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (password === AUTH_PASSWORD) {
      return true;
    }
  }

  // Check request body as fallback
  if (event.body) {
    try {
      const body = JSON.parse(event.body);
      if (body.password === AUTH_PASSWORD) {
        return true;
      }
    } catch (e) {
      // Invalid JSON, ignore
    }
  }

  return false;
}

function unauthorizedResponse() {
  return {
    statusCode: 401,
    headers,
    body: JSON.stringify({ error: 'Unauthorized - invalid password' }),
  };
}

export const handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method;
  // Use routeKey for HTTP API v2, which doesn't include the stage
  const routeKey = event.routeKey;
  // Fallback path handling - strip stage prefix if present
  let path = event.path || event.rawPath || '';
  const stage = event.requestContext?.stage;
  if (stage && path.startsWith(`/${stage}`)) {
    path = path.slice(stage.length + 1) || '/';
  }

  try {
    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    // GET /feeding - Get all feeding history (PUBLIC - no auth required)
    if (routeKey === 'GET /feeding' || (method === 'GET' && path === '/feeding')) {
      return await getFeedings();
    }

    // POST /feeding - Add a new feeding (PROTECTED)
    if (routeKey === 'POST /feeding' || (method === 'POST' && path === '/feeding')) {
      if (!checkAuth(event)) {
        return unauthorizedResponse();
      }
      const body = JSON.parse(event.body || '{}');
      return await addFeeding(body);
    }

    // DELETE /feeding/{id} - Delete a specific feeding (PROTECTED)
    if (routeKey === 'DELETE /feeding/{id}' || (method === 'DELETE' && path.startsWith('/feeding/') && path !== '/feeding')) {
      if (!checkAuth(event)) {
        return unauthorizedResponse();
      }
      const id = path.split('/').pop() || event.pathParameters?.id;
      return await deleteFeeding(id);
    }

    // DELETE /feeding - Clear all history (PROTECTED)
    if (routeKey === 'DELETE /feeding' || (method === 'DELETE' && path === '/feeding')) {
      if (!checkAuth(event)) {
        return unauthorizedResponse();
      }
      return await clearAllFeedings();
    }

    // GET /snapshot/upload-url - Get presigned URL for uploading snapshot (PROTECTED)
    if (routeKey === 'GET /snapshot/upload-url' || (method === 'GET' && path === '/snapshot/upload-url')) {
      if (!checkAuth(event)) {
        return unauthorizedResponse();
      }
      return await getSnapshotUploadUrl();
    }

    // GET /snapshot/meta - Get snapshot metadata (PUBLIC - needed for live view)
    if (routeKey === 'GET /snapshot/meta' || (method === 'GET' && path === '/snapshot/meta')) {
      return await getSnapshotMeta();
    }

    // DELETE /snapshot - Delete current snapshot (PROTECTED)
    if (routeKey === 'DELETE /snapshot' || (method === 'DELETE' && path === '/snapshot')) {
      if (!checkAuth(event)) {
        return unauthorizedResponse();
      }
      return await deleteSnapshot();
    }

    // POST /snapshot/meta - Update snapshot metadata (PROTECTED)
    if (routeKey === 'POST /snapshot/meta' || (method === 'POST' && path === '/snapshot/meta')) {
      if (!checkAuth(event)) {
        return unauthorizedResponse();
      }
      const body = JSON.parse(event.body || '{}');
      return await updateSnapshotMeta(body);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

async function getFeedings() {
  const command = new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': PARTITION_KEY,
    },
    ScanIndexForward: false, // Most recent first
    Limit: 50,
  });

  const result = await docClient.send(command);

  const feedings = (result.Items || []).map((item) => ({
    timestamp: item.timestamp,
    id: parseInt(item.sk, 10),
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(feedings),
  };
}

async function addFeeding(body) {
  const now = new Date();
  const id = body.id || Date.now();
  const timestamp = body.timestamp || now.toISOString();

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: PARTITION_KEY,
      sk: String(id), // Sort key as string for proper ordering
      timestamp: timestamp,
      createdAt: now.toISOString(),
    },
  });

  await docClient.send(command);

  return {
    statusCode: 201,
    headers,
    body: JSON.stringify({ timestamp, id }),
  };
}

async function deleteFeeding(id) {
  const command = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: PARTITION_KEY,
      sk: String(id),
    },
  });

  await docClient.send(command);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ deleted: id }),
  };
}

async function clearAllFeedings() {
  // First, get all items
  const queryCommand = new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': PARTITION_KEY,
    },
  });

  const result = await docClient.send(queryCommand);

  // Delete each item
  const deletePromises = (result.Items || []).map((item) =>
    docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: item.pk,
          sk: item.sk,
        },
      })
    )
  );

  await Promise.all(deletePromises);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ cleared: true }),
  };
}

// Snapshot functions

async function getSnapshotUploadUrl() {
  const command = new PutObjectCommand({
    Bucket: SNAPSHOT_BUCKET,
    Key: SNAPSHOT_KEY,
    ContentType: 'image/jpeg',
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ uploadUrl, key: SNAPSHOT_KEY }),
  };
}

async function getSnapshotMeta() {
  try {
    // Try to get the image metadata
    const headCommand = new HeadObjectCommand({
      Bucket: SNAPSHOT_BUCKET,
      Key: SNAPSHOT_KEY,
    });

    const headResult = await s3Client.send(headCommand);

    // Get custom metadata or use LastModified
    const timestamp = headResult.Metadata?.timestamp || headResult.LastModified?.toISOString();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        exists: true,
        timestamp: timestamp,
        lastModified: headResult.LastModified?.toISOString(),
        size: headResult.ContentLength,
        url: `https://s3.us-east-1.amazonaws.com/${SNAPSHOT_BUCKET}/${SNAPSHOT_KEY}`,
      }),
    };
  } catch (error) {
    // Handle both 404 (not found) and 403 (access denied for non-existent key)
    const httpStatus = error.$metadata?.httpStatusCode;
    if (error.name === 'NotFound' || httpStatus === 404 || httpStatus === 403) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          exists: false,
          timestamp: null,
          url: null,
        }),
      };
    }
    throw error;
  }
}

async function deleteSnapshot() {
  const deleteImage = new DeleteObjectCommand({
    Bucket: SNAPSHOT_BUCKET,
    Key: SNAPSHOT_KEY,
  });

  await s3Client.send(deleteImage);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ deleted: true }),
  };
}

async function updateSnapshotMeta(body) {
  // This updates the metadata by copying the object to itself with new metadata
  // For simplicity, we'll just return success - the upload itself sets LastModified
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ updated: true, timestamp: body.timestamp }),
  };
}
