"use client";

import Link from "next/link";
import { useState } from "react";

import type { UserWork } from "@/lib/admin-users";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function UsersPanel({ users }: { users: UserWork[] }) {
  const [openId, setOpenId] = useState<string | null>(users[0]?.id ?? null);

  if (users.length === 0) {
    return <p className="text-soft text-[13px]">No accounts yet.</p>;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {users.map((user) => {
        const open = openId === user.id;
        return (
          <li
            key={user.id}
            className="glass-inset p-3"
            style={{ borderRadius: "var(--radius-row)" }}
          >
            <button
              type="button"
              className="flex w-full items-start gap-3 text-left"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : user.id)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">
                  {user.name}
                  <span className="text-soft ml-2 text-[11px] font-normal">
                    {user.role === "ADMIN" ? "admin" : "contributor"}
                  </span>
                </span>
                <span className="text-soft block truncate text-[12px]">{user.email}</span>
              </span>
              <span className="text-soft shrink-0 text-[12px]">
                {user.annotationCount} annotation{user.annotationCount === 1 ? "" : "s"}
                {" · "}
                {user.editCount} edit{user.editCount === 1 ? "" : "s"}
              </span>
            </button>

            {open ? <UserDetail user={user} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function UserDetail({ user }: { user: UserWork }) {
  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3 hairline text-[13px]">
      <p className="text-soft text-[12px]">
        Joined {when(user.joinedAt)}
        {user.lastActiveAt ? ` · last active ${when(user.lastActiveAt)}` : " · no work yet"}
      </p>

      {user.annotationsByType.length > 0 ? (
        <div>
          <p className="mb-1 text-[12px] font-medium">Annotations</p>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {user.annotationsByType.map((row) => (
              <li
                key={row.type}
                className="pill"
                style={{
                  background: "color-mix(in oklch, var(--accent) 10%, transparent)",
                }}
              >
                {row.label} · {row.count}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-soft">No annotations yet.</p>
      )}

      {user.assigned.length > 0 ? (
        <div>
          <p className="mb-1 text-[12px] font-medium">
            Assigned recordings ({user.assignedCount})
          </p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {user.assigned.map((rec) => (
              <li key={rec.id}>
                <Link className="text-[12px]" href={`/r/${rec.id}`}>
                  {rec.filename}
                </Link>
                <span className="text-soft"> · {rec.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-soft">No recordings assigned.</p>
      )}

      {user.recent.length > 0 ? (
        <div>
          <p className="mb-1 text-[12px] font-medium">Recent work</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {user.recent.map((item, index) => (
              <li key={`${item.at}-${index}`} className="flex flex-col gap-0.5">
                <span>{item.summary}</span>
                <span className="text-soft text-[11px]">
                  <Link href={`/r/${item.recordingId}`}>{item.filename}</Link>
                  {" · "}
                  {when(item.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-soft">Nothing recorded in the activity log yet.</p>
      )}
    </div>
  );
}
