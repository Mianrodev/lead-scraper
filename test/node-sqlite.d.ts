// Node's built-in SQLite (Node 22.5+), used by tests to run generated SQL for real. The project
// is typed for Workers, not Node, so only the few members the tests use are declared here.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { run(...values: unknown[]): unknown; all(...values: unknown[]): unknown[] };
  }
}
