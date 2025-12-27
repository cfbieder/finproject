declare module "@babel/template" {
  import type { Node } from "@babel/types";

  export interface TemplateBuilderOptions {
    [option: string]: unknown;
  }

  export type TemplateBuilder<T = Node> = (
    opts?: TemplateBuilderOptions
  ) => T;

  export default function template<T = Node>(
    code: string,
    options?: TemplateBuilderOptions
  ): TemplateBuilder<T>;
}
