import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'express/index': 'src/presentation/express/index.ts',
    'fastify/index': 'src/presentation/fastify/index.ts',
    'nest/index': 'src/presentation/nest/index.ts',
    'mcp/index': 'src/presentation/mcp/index.ts',
    'mcp/bin': 'src/presentation/mcp/bin.ts',
    'sisp/index': 'src/presentation/sisp/index.ts',
    'prisma/index': 'src/prisma/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: {
    entry: {
      index: 'src/index.ts',
      'express/index': 'src/presentation/express/index.ts',
      'fastify/index': 'src/presentation/fastify/index.ts',
      'nest/index': 'src/presentation/nest/index.ts',
      'mcp/index': 'src/presentation/mcp/index.ts',
      'sisp/index': 'src/presentation/sisp/index.ts',
      'prisma/index': 'src/prisma/index.ts',
    },
  },
  noExternal: ['dinero.js'],
  sourcemap: true,
  clean: true,
  target: 'node20',
});
