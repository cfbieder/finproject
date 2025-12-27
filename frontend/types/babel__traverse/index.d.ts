declare module "@babel/traverse" {
  import type { Node } from "@babel/types";

  export interface TraverseOptions<T = {}> {
    [key: string]:
      | ((path: NodePath<Node>, state: T) => void)
      | undefined;
  }

  export interface NodePath<T = Node> {
    node: T;
    parent: Node | null;
    key: string | null;
    parentKey: string | null;
    remove(): void;
    replaceWith(replacement: Node): void;
    skip(): void;
    stop(): void;
  }

  export default function traverse<T>(
    ast: Node,
    options?: TraverseOptions<T>,
    state?: T,
    parentPath?: NodePath<Node>
  ): void;
}
