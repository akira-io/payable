import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { createPayableMcpServer } from '../src/presentation/mcp/index';
import { serveHttp } from '../src/presentation/mcp/transports/http';
import { FakeProvider } from './support/fake-provider';

describe('mcp http transport', () => {
  it('serves tool calls over streamable http', async () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() } });
    const http = await serveHttp(() => createPayableMcpServer(payable), { port: 0 });
    const { port } = http.address() as AddressInfo;

    const client = new Client({ name: 'test', version: '0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);

    const result = (await client.callTool({
      name: 'providers_list',
      arguments: {},
    })) as CallToolResult;
    const block = result.content[0];
    const names = block?.type === 'text' ? JSON.parse(block.text) : [];

    expect(names).toEqual(['stripe']);

    await client.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
});
