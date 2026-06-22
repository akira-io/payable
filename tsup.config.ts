import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'express/index': 'src/presentation/express/index.ts',
    'fastify/index': 'src/presentation/fastify/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: {
    entry: {
      index: 'src/index.ts',
      'express/index': 'src/presentation/express/index.ts',
      'fastify/index': 'src/presentation/fastify/index.ts',
    },
  },
  noExternal: ['dinero.js'],
  sourcemap: true,
  clean: true,
  target: 'node20',
});
