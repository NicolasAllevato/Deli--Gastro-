// @types/node 20 no trae node:sqlite (Node 22.5+). Declaración mínima para los tests D1.
declare module "node:sqlite" {
  type Value = string | number | bigint | null | Uint8Array;
  export class StatementSync {
    get(...params: Value[]): unknown;
    all(...params: Value[]): unknown[];
    run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
