/** Native form POST — clears the session on this origin (see DECISIONS.md). */
export function SignOutButton({ className = "control" }: { className?: string }) {
  return (
    <form action="/logout" method="post">
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
