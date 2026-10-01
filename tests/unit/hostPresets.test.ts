import { describe, expect, it } from 'vitest';
import { HOST_PRESETS, applyPreset, type PresetTarget } from '../../src/renderer/lib/hostPresets';
import vi from '../../src/renderer/i18n/vi.json';

const preset = (id: string) => HOST_PRESETS.find((p) => p.id === id)!;
const empty: PresetTarget = { patterns: '', hostName: '', user: '', port: '', identitiesOnly: '', strictHostKeyChecking: '' };

describe('host presets', () => {
  it('fills an empty form, including the alias and IdentitiesOnly', () => {
    expect(applyPreset(empty, preset('github443'))).toEqual({ patterns: 'github.com', hostName: 'ssh.github.com', user: 'git', port: '443', identitiesOnly: 'yes', strictHostKeyChecking: 'accept-new' });
  });

  it('replaces HostName/User/Port but keeps an existing alias, IdentitiesOnly and other fields', () => {
    const form = { ...empty, patterns: 'work', hostName: 'old', user: 'old', port: '2222', identitiesOnly: 'no' as const, strictHostKeyChecking: 'yes', identityFile: 'id_x' };
    expect(applyPreset(form, preset('gitlab'))).toEqual({ patterns: 'work', hostName: 'gitlab.com', user: 'git', port: '', identitiesOnly: 'no', strictHostKeyChecking: 'yes', identityFile: 'id_x' });
  });

  it('switching presets does not leave values (or the auto-filled alias) from the previous one', () => {
    const r = applyPreset(applyPreset(empty, preset('github443')), preset('codecommit'), preset('github443'));
    expect(r).toMatchObject({ patterns: 'aws-codecommit', hostName: '', user: '', port: '' });
  });

  it('keeps an alias the user typed after picking a preset', () => {
    const typed = { ...applyPreset(empty, preset('github')), patterns: 'gh-work' };
    expect(applyPreset(typed, preset('github443'), preset('github')).patterns).toBe('gh-work');
  });

  it('has unique ids and a Vietnamese note for every preset that needs one', () => {
    expect(new Set(HOST_PRESETS.map((p) => p.id)).size).toBe(HOST_PRESETS.length);
    for (const p of HOST_PRESETS.filter((x) => x.hasNote)) expect(vi, p.id).toHaveProperty([`config.presetNote.${p.id}`]);
  });
});
