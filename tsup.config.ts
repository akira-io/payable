import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: {
    entry: {
      index: 'src/index.ts',
    },
  },
  noExternal: ['dinero.js'],
  sourcemap: true,
  clean: true,
  target: 'node20',
});
