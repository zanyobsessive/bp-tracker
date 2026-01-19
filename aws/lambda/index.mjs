import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'bp-feeding-history';
const PARTITION_KEY = 'FEEDING_LOG'; // Single partition for all feeding records

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

    // GET /feeding - Get all feeding history
    if (routeKey === 'GET /feeding' || (method === 'GET' && path === '/feeding')) {
      return await getFeedings();
    }

    // POST /feeding - Add a new feeding
    if (routeKey === 'POST /feeding' || (method === 'POST' && path === '/feeding')) {
      const body = JSON.parse(event.body || '{}');
      return await addFeeding(body);
    }

    // DELETE /feeding/{id} - Delete a specific feeding (undo)
    if (routeKey === 'DELETE /feeding/{id}' || (method === 'DELETE' && path.startsWith('/feeding/') && path !== '/feeding')) {
      const id = path.split('/').pop() || event.pathParameters?.id;
      return await deleteFeeding(id);
    }

    // DELETE /feeding - Clear all history
    if (routeKey === 'DELETE /feeding' || (method === 'DELETE' && path === '/feeding')) {
      return await clearAllFeedings();
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
