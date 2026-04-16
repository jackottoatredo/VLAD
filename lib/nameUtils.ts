/** Split email prefix on `.` and `_`, title-case each part. */
export function emailToName(email: string): {
  firstName: string;
  lastName: string;
} {
  const prefix = email.split("@")[0];
  const parts = prefix.split(/[._]/);
  const titleCase = (s: string) =>
    s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return {
    firstName: parts[0] ? titleCase(parts[0]) : "",
    lastName: parts
      .slice(1)
      .map((p) => titleCase(p))
      .join(" "),
  };
}
