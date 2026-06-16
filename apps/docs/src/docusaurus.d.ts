declare module "@docusaurus/Link" {
  import type { AnchorHTMLAttributes, ReactNode } from "react";

  export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
    to?: string;
    href?: string;
  }

  export default function Link(props: LinkProps): ReactNode;
}

declare module "@theme/Layout" {
  import type { ReactNode } from "react";

  export interface LayoutProps {
    children?: ReactNode;
    description?: string;
    title?: string;
  }

  export default function Layout(props: LayoutProps): ReactNode;
}
