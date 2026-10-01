/** Well-known SSH endpoints offered in the config form so users do not have to look up HostName/User/Port. */
export interface HostPreset {
  id: string;
  label: string;
  /** Suggested Host alias, used only when the alias field is still empty. */
  alias: string;
  /** Empty when the value differs per account/instance; the placeholder then shows the expected shape. */
  hostName: string;
  user: string;
  port: string;
  hostNamePlaceholder?: string;
  userPlaceholder?: string;
  /** True when the preset needs values the user must fill in (the page shows the matching note). */
  hasNote: boolean;
}

export const HOST_PRESETS: readonly HostPreset[] = [
  { id: 'github', label: 'GitHub', alias: 'github.com', hostName: 'github.com', user: 'git', port: '', hasNote: false },
  { id: 'github443', label: 'GitHub (port 443)', alias: 'github.com', hostName: 'ssh.github.com', user: 'git', port: '443', hasNote: true },
  { id: 'gitlab', label: 'GitLab.com', alias: 'gitlab.com', hostName: 'gitlab.com', user: 'git', port: '', hasNote: false },
  { id: 'gitlab443', label: 'GitLab.com (port 443)', alias: 'gitlab.com', hostName: 'altssh.gitlab.com', user: 'git', port: '443', hasNote: true },
  { id: 'bitbucket', label: 'Bitbucket', alias: 'bitbucket.org', hostName: 'bitbucket.org', user: 'git', port: '', hasNote: false },
  { id: 'bitbucket443', label: 'Bitbucket (port 443)', alias: 'bitbucket.org', hostName: 'altssh.bitbucket.org', user: 'git', port: '443', hasNote: true },
  { id: 'azure', label: 'Azure DevOps', alias: 'ssh.dev.azure.com', hostName: 'ssh.dev.azure.com', user: 'git', port: '', hasNote: false },
  {
    id: 'codecommit',
    label: 'AWS CodeCommit',
    alias: 'aws-codecommit',
    hostName: '',
    user: '',
    port: '',
    hostNamePlaceholder: 'git-codecommit.ap-southeast-1.amazonaws.com',
    userPlaceholder: 'APKAEIBAERJR2EXAMPLE',
    hasNote: true
  },
  {
    id: 'ec2',
    label: 'AWS EC2',
    alias: 'aws-ec2',
    hostName: '',
    user: 'ec2-user',
    port: '',
    hostNamePlaceholder: 'ec2-13-250-1-2.ap-southeast-1.compute.amazonaws.com',
    hasNote: true
  },
  { id: 'codeberg', label: 'Codeberg', alias: 'codeberg.org', hostName: 'codeberg.org', user: 'git', port: '', hasNote: false },
  { id: 'huggingface', label: 'Hugging Face', alias: 'hf.co', hostName: 'hf.co', user: 'git', port: '', hasNote: false },
  { id: 'server', label: 'Linux server / VPS', alias: 'my-server', hostName: '', user: 'root', port: '', hostNamePlaceholder: '203.0.113.10', hasNote: true }
];

export interface PresetTarget {
  patterns: string;
  hostName: string;
  user: string;
  port: string;
  identitiesOnly: '' | 'yes' | 'no';
  strictHostKeyChecking: string;
}

/**
 * Replaces HostName/User/Port with the preset (the user picked it explicitly). The alias is filled only
 * when empty or still equal to the alias the previous preset filled in, so a typed alias is kept but
 * switching GitHub -> CodeCommit does not leave "github.com" behind. IdentitiesOnly and StrictHostKeyChecking
 * (accept-new: the first connection records the host key, a changed key is still refused) are filled only when unset.
 */
export function applyPreset<T extends PresetTarget>(form: T, p: HostPreset, previous: HostPreset | null = null): T {
  const autoAlias = !form.patterns.trim() || (previous !== null && form.patterns.trim() === previous.alias);
  return {
    ...form,
    patterns: autoAlias ? p.alias : form.patterns,
    hostName: p.hostName,
    user: p.user,
    port: p.port,
    identitiesOnly: form.identitiesOnly || 'yes',
    strictHostKeyChecking: form.strictHostKeyChecking || 'accept-new'
  };
}
