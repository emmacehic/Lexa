import type { ReactNode } from "react";

/**
 * The workspace has a parallel slot for the export sheet, so ⌘E presents a
 * sheet over the workspace rather than navigating away from it (§10).
 */
export default function WorkspaceLayout({
  children,
  sheet,
}: {
  children: ReactNode;
  sheet: ReactNode;
}) {
  return (
    <>
      {children}
      {sheet}
    </>
  );
}
