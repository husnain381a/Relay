import { execFileSync } from "node:child_process";

const git = (...args) =>
  execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
const objects = new Map();
for (const row of git("rev-list", "--objects", "--all")
  .toString()
  .trim()
  .split("\n")) {
  const space = row.indexOf(" ");
  if (space > 0) objects.set(row.slice(0, space), row.slice(space + 1));
}
// Include staged changes before committing as well as every reachable historical blob.
for (const row of git("ls-files", "--stage", "-z").toString().split("\0")) {
  const match = /^\d+ ([0-9a-f]+) \d\t([\s\S]+)$/.exec(row);
  if (match) objects.set(match[1], match[2]);
}
const ids = [...objects.keys()];
const data = execFileSync("git", ["cat-file", "--batch"], {
  input: ids.join("\n") + "\n",
  maxBuffer: 128 * 1024 * 1024,
});
const findings = [];
const patterns = [
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{20,}/],
  [
    "GitHub token",
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,
  ],
  ["AWS access key", /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  [
    "Private signing key",
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  ["Database URL with password", /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]{6,}@/],
  ["npm authentication token", /npm_[A-Za-z0-9]{30,}/],
];
let offset = 0,
  blobs = 0;
for (const id of ids) {
  const end = data.indexOf(10, offset);
  const header = data.subarray(offset, end).toString().split(" ");
  const size = Number(header[2]);
  const body = data.subarray(end + 1, end + 1 + size);
  offset = end + size + 2;
  if (header[1] !== "blob") continue;
  blobs++;
  const path = objects.get(id);
  const flag = (rule) => findings.push({ path, blob: id.slice(0, 12), rule });
  if (/(?:^|\/)\.env(?:\.[^/]*)?$/.test(path) && !path.endsWith(".env.example"))
    flag("Environment file");
  if (/\.(?:exe|msi|msix|appx|pfx|p12|pem|key)$/i.test(path))
    flag("Installer or credential artifact");
  if (body.includes(0)) continue;
  const text = body.toString("utf8");
  for (const [name, pattern] of patterns) if (pattern.test(text)) flag(name);
  for (const jwt of text.matchAll(
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  )) {
    try {
      if (
        JSON.parse(Buffer.from(jwt[0].split(".")[1], "base64url").toString())
          .role === "service_role"
      )
        flag("Privileged Supabase JWT");
    } catch {}
  }
}
console.log(
  JSON.stringify(
    {
      historicalAndStagedBlobsScanned: blobs,
      findings,
      note: "Pattern-based review; does not prove absence of every possible secret.",
    },
    null,
    2,
  ),
);
process.exitCode = findings.length ? 1 : 0;
