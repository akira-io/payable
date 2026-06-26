import type { Knex } from 'knex';

export async function createIfMissing(
  knex: Knex,
  name: string,
  build: (table: Knex.CreateTableBuilder) => void,
): Promise<void> {
  if (await knex.schema.hasTable(name)) {
    return;
  }
  try {
    await knex.schema.createTable(name, build);
  } catch (error) {
    if (!(await knex.schema.hasTable(name))) {
      throw error;
    }
  }
}
