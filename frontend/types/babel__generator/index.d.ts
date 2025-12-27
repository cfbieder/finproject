declare module "@babel/generator" {
  import type { Node } from "@babel/types";

  export interface GeneratorOptions {
    [option: string]: unknown;
  }

  export interface GeneratorResult {
    code: string;
    map?: unknown;
    ast?: Node;
  }

  export default function generate(
    ast: Node,
    options?: GeneratorOptions,
    code?: string | { [filename: string]: string }
  ): GeneratorResult;
}
