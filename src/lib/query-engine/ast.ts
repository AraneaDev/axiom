export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | '~';

export type Value =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'function'; name: string; args: Value[] }
  | { type: 'null' };

export type Expression =
  | { type: 'comparison'; field: string; operator: ComparisonOp; value: Value }
  | { type: 'in'; field: string; values: Value[]; negated: boolean }
  | { type: 'and'; left: Expression; right: Expression }
  | { type: 'or'; left: Expression; right: Expression }
  | { type: 'not'; operand: Expression }
  | { type: 'freetext'; value: string };

export interface QueryParseError {
  message: string;
  position: number;
  token?: string;
}

export interface FieldDefinition {
  column: string;
  type: 'enum' | 'string' | 'number' | 'date' | 'relation' | 'user';
  values?: string[];
  ordinal?: boolean;
  join?: string;
  many?: boolean;
  aliasField?: string;
  /** The column can be empty, so `= null` is a question it can answer */
  nullable?: boolean;
}

export type FieldRegistry = Record<string, FieldDefinition>;

export interface QueryContext {
  currentUserId?: string;
  projectId?: string;
}
