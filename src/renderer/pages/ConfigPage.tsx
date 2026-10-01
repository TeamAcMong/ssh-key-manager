import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Tab,
  TabList,
  Text,
  Textarea,
  Title3,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import { Add20Regular, Delete20Regular, DocumentTextRegular, Save20Regular } from '@fluentui/react-icons';
import type { ConfigPreview, ConfigSnapshot, HostEdit, HostEntry, HostFields, KeyInfo, SkmErrorData, StrictHostKeyChecking } from '../../core/types';
import { t, type MessageKey } from '../i18n/t';
import { api, call, errorData } from '../lib/api';
import { HOST_PRESETS, applyPreset } from '../lib/hostPresets';
import { EmptyState, ErrorCard, useNotify } from '../components/common';
import { DiffDialog } from '../components/DiffDialog';

const useStyles = makeStyles({
  page: { padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, height: '100%', boxSizing: 'border-box', minHeight: 0 },
  header: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  title: { marginRight: 'auto' },
  body: { display: 'flex', gap: tokens.spacingHorizontalM, flexGrow: 1, minHeight: 0 },
  list: {
    flex: '0 0 260px',
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    flexDirection: 'column'
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: 'none',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: 'transparent',
    color: tokens.colorNeutralForeground1,
    textAlign: 'left',
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover }
  },
  itemActive: { backgroundColor: tokens.colorBrandBackground2, ':hover': { backgroundColor: tokens.colorBrandBackground2Hover } },
  sub: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' },
  editor: {
    flexGrow: 1,
    minWidth: 0,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    overflow: 'auto',
    boxSizing: 'border-box',
    // Children must keep their natural height; otherwise a long note shrinks and the next field overlaps it.
    '> *': { flexShrink: 0 }
  },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: tokens.spacingHorizontalM, alignItems: 'start' },
  actions: { display: 'flex', gap: tokens.spacingHorizontalS },
  raw: { flexGrow: 1, display: 'flex', minHeight: '300px' },
  others: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, margin: 0 }
});

interface FormState {
  patterns: string;
  hostName: string;
  user: string;
  port: string;
  identityFile: string;
  extraIdentityFiles: string[];
  identitiesOnly: '' | 'yes' | 'no';
  strictHostKeyChecking: '' | StrictHostKeyChecking;
}

const EMPTY_FORM: FormState = { patterns: '', hostName: '', user: '', port: '', identityFile: '', extraIdentityFiles: [], identitiesOnly: '', strictHostKeyChecking: '' };

function formFromHost(h: HostEntry): FormState {
  return {
    patterns: h.patterns.join(' '),
    hostName: h.hostName ?? '',
    user: h.user ?? '',
    port: h.port === null ? '' : String(h.port),
    identityFile: h.identityFiles[0] ?? '',
    extraIdentityFiles: h.identityFiles.slice(1),
    identitiesOnly: h.identitiesOnly ?? '',
    strictHostKeyChecking: h.strictHostKeyChecking ?? ''
  };
}

function fieldsFromForm(f: FormState): HostFields {
  return {
    patterns: f.patterns.trim().split(/\s+/).filter(Boolean),
    hostName: f.hostName.trim() || null,
    user: f.user.trim() || null,
    port: f.port.trim() ? Number(f.port) : null,
    identityFiles: [f.identityFile, ...f.extraIdentityFiles].filter(Boolean),
    identitiesOnly: f.identitiesOnly || null,
    strictHostKeyChecking: f.strictHostKeyChecking || null
  };
}

const STRICT_LABELS: Record<StrictHostKeyChecking, () => string> = {
  'accept-new': () => t('config.strict.acceptNew'),
  yes: () => t('config.strict.yes'),
  ask: () => t('config.strict.ask'),
  no: () => t('config.strict.no'),
  off: () => t('config.strict.no')
};

const STRICT_OPTIONS: StrictHostKeyChecking[] = ['accept-new', 'yes', 'ask', 'no'];
// "off" (alias of "no") is only offered when the file already uses it, so the dropdown can show it.
const STRICT_OPTIONS_WITH_OFF: StrictHostKeyChecking[] = [...STRICT_OPTIONS, 'off'];

/** "id_ed25519_github" -> "github" as a suggested Host alias. */
function suggestAlias(keyId: string): string {
  return keyId.replace(/^id_(ed25519|rsa|ecdsa)_?/, '') || 'my-host';
}

export function ConfigPage(props: { refreshSignal: number; draftKeyId: string | null; onDraftConsumed: () => void }): JSX.Element {
  const s = useStyles();
  const notify = useNotify();
  const [snap, setSnap] = useState<ConfigSnapshot | null>(null);
  const [keys, setKeys] = useState<{ key: KeyInfo; ref: string }[]>([]);
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [presetId, setPresetId] = useState<string>('');
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [pending, setPending] = useState<{ edits: HostEdit[]; preview: ConfigPreview } | null>(null);
  const [error, setError] = useState<SkmErrorData | null>(null);

  const load = useCallback(async (): Promise<ConfigSnapshot | null> => {
    try {
      const [c, list] = await Promise.all([call(api().config.read()), call(api().keys.list())]);
      const privates = list.filter((k) => k.hasPrivate);
      const refs = await Promise.all(privates.map(async (k) => ({ key: k, ref: await call(api().config.identityFileRef(k.id)) })));
      setSnap(c);
      setKeys(refs);
      return c;
    } catch (e) {
      setError(errorData(e));
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, props.refreshSignal]);

  // "Tạo Host trong config" from the Generate dialog: open a new host pre-filled with the key.
  const { draftKeyId, onDraftConsumed } = props;
  useEffect(() => {
    if (!draftKeyId) return;
    call(api().config.identityFileRef(draftKeyId))
      .then((ref) => {
        setSelected('new');
        setTab('form');
        setForm({ ...EMPTY_FORM, patterns: suggestAlias(draftKeyId), identityFile: ref, identitiesOnly: 'yes' });
      })
      .catch((e: unknown) => setError(errorData(e)))
      .finally(onDraftConsumed);
  }, [draftKeyId, onDraftConsumed]);

  const hosts = snap?.hosts ?? [];
  const current = typeof selected === 'number' ? (hosts[selected] ?? null) : null;
  const isMatch = current?.kind === 'match';
  const preset = HOST_PRESETS.find((p) => p.id === presetId) ?? null;
  const portInvalid = form.port.trim() !== '' && !/^\d{1,5}$/.test(form.port.trim());
  const identityOptions = useMemo(() => {
    const opts = keys.map((k) => ({ value: k.ref, label: k.key.id }));
    if (form.identityFile && !opts.some((o) => o.value === form.identityFile)) opts.unshift({ value: form.identityFile, label: form.identityFile });
    return opts;
  }, [keys, form.identityFile]);

  const select = (idx: number | 'new'): void => {
    setSelected(idx);
    setError(null);
    setPresetId('');
    setForm(idx === 'new' ? EMPTY_FORM : formFromHost(hosts[idx] as HostEntry));
  };

  const openDiff = async (edits: HostEdit[]): Promise<void> => {
    setError(null);
    try {
      const preview = await call(api().config.preview(edits));
      setPending({ edits, preview });
    } catch (e) {
      setError(errorData(e));
    }
  };

  const save = (): Promise<void> => {
    const fields = fieldsFromForm(form);
    return openDiff(selected === 'new' ? [{ op: 'add', fields }] : [{ op: 'update', index: selected as number, fields }]);
  };

  const confirmWrite = async (): Promise<void> => {
    if (!pending) return;
    const r = await call(api().config.write(pending.edits, pending.preview.hash));
    const edit = pending.edits[0];
    setPending(null);
    notify.success(r.backupPath ? `${t('config.saved')} — ${t('config.backup', { file: r.backupPath.split(/[\\/]/).pop() ?? '' })}` : t('config.saved'));
    const next = await load();
    if (!next) return;
    if (edit?.op === 'delete') {
      setSelected(null);
      setForm(EMPTY_FORM);
    } else if (edit) {
      const first = edit.fields.patterns.join(' ');
      const idx = next.hosts.findIndex((h) => h.patterns.join(' ') === first);
      if (idx >= 0) {
        setSelected(idx);
        setForm(formFromHost(next.hosts[idx] as HostEntry));
      }
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]): void => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className={s.page} data-testid="config-page">
      <div className={s.header}>
        <Title3 className={s.title}>{t('config.title')}</Title3>
        <Button appearance="primary" icon={<Add20Regular />} onClick={() => select('new')} data-testid="config-add">
          {t('config.addHost')}
        </Button>
      </div>
      {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}
      {snap && !snap.exists ? (
        <MessageBar intent="info">
          <MessageBarBody>{t('config.noFile')}</MessageBarBody>
        </MessageBar>
      ) : null}

      <TabList selectedValue={tab} onTabSelect={(_e, d) => setTab(d.value as 'form' | 'raw')} size="small">
        <Tab value="form">{t('config.tab.form')}</Tab>
        <Tab value="raw" data-testid="config-tab-raw">
          {t('config.tab.raw')}
        </Tab>
      </TabList>

      {tab === 'raw' ? (
        <div className={s.raw}>
          <Textarea
            readOnly
            value={snap?.raw ?? ''}
            resize="none"
            style={{ flexGrow: 1 }}
            textarea={{ style: { fontFamily: tokens.fontFamilyMonospace, fontSize: '12px', height: '100%' } }}
            data-testid="config-raw"
          />
        </div>
      ) : (
        <div className={s.body}>
          <nav className={s.list} aria-label="Host">
            {hosts.length === 0 && selected !== 'new' ? (
              <EmptyState icon={<DocumentTextRegular fontSize={40} />} title={t('config.empty')} body={t('config.emptyBody')} />
            ) : null}
            {hosts.map((h) => (
              <button key={h.index} className={mergeClasses(s.item, selected === h.index && s.itemActive)} onClick={() => select(h.index)} data-testid={`host-${h.patterns.join('_')}`}>
                <Text weight="semibold">{h.kind === 'match' ? `Match ${h.patterns[0] ?? ''}` : h.patterns.join(' ')}</Text>
                <span className={s.sub}>{[h.user, h.hostName].filter(Boolean).join('@') || '—'}</span>
              </button>
            ))}
            {selected === 'new' ? (
              <button className={mergeClasses(s.item, s.itemActive)}>
                <Text weight="semibold">{form.patterns || t('config.newHost')}</Text>
              </button>
            ) : null}
          </nav>

          <section className={s.editor}>
            {selected === null ? (
              <EmptyState icon={<DocumentTextRegular fontSize={40} />} body={t('config.select')} />
            ) : isMatch ? (
              <MessageBar intent="info">
                <MessageBarBody>{t('config.match')}</MessageBarBody>
              </MessageBar>
            ) : (
              <>
                {selected === 'new' ? (
                  <Field label={t('config.preset')} hint={t('config.presetHint')}>
                    <Dropdown
                      value={preset?.label ?? ''}
                      placeholder={t('config.presetPick')}
                      selectedOptions={presetId ? [presetId] : []}
                      onOptionSelect={(_e, d) => {
                        const p = HOST_PRESETS.find((x) => x.id === d.optionValue);
                        if (!p) return;
                        setPresetId(p.id);
                        setForm((f) => applyPreset(f, p, preset));
                      }}
                      data-testid="cfg-preset"
                    >
                      {HOST_PRESETS.map((p) => (
                        <Option key={p.id} value={p.id} text={p.label}>
                          {p.label}
                        </Option>
                      ))}
                    </Dropdown>
                  </Field>
                ) : null}
                {selected === 'new' && preset?.hasNote ? (
                  <MessageBar intent="info" layout="multiline" data-testid="cfg-preset-note">
                    <MessageBarBody>{t(`config.presetNote.${preset.id}` as MessageKey)}</MessageBarBody>
                  </MessageBar>
                ) : null}
                <Field label={t('config.patterns')} required>
                  <Input value={form.patterns} onChange={(_e, d) => set('patterns', d.value)} data-testid="cfg-patterns" autoFocus={selected === 'new'} />
                </Field>
                <div className={s.grid}>
                  <Field label={t('config.hostName')}>
                    <Input value={form.hostName} onChange={(_e, d) => set('hostName', d.value)} placeholder={preset?.hostNamePlaceholder ?? 'github.com'} data-testid="cfg-hostname" />
                  </Field>
                  <Field label={t('config.user')}>
                    <Input value={form.user} onChange={(_e, d) => set('user', d.value)} placeholder={preset?.userPlaceholder ?? 'git'} data-testid="cfg-user" />
                  </Field>
                  <Field label={t('config.port')} validationState={portInvalid ? 'error' : 'none'} validationMessage={portInvalid ? t('config.portInvalid') : undefined}>
                    <Input value={form.port} onChange={(_e, d) => set('port', d.value)} placeholder="22" data-testid="cfg-port" />
                  </Field>
                  <Field label={t('config.identitiesOnly')}>
                    <Dropdown
                      value={form.identitiesOnly || t('config.unset')}
                      selectedOptions={[form.identitiesOnly]}
                      onOptionSelect={(_e, d) => set('identitiesOnly', (d.optionValue ?? '') as FormState['identitiesOnly'])}
                    >
                      <Option value="">{t('config.unset')}</Option>
                      <Option value="yes">yes</Option>
                      <Option value="no">no</Option>
                    </Dropdown>
                  </Field>
                </div>
                <Field
                  label={t('config.strict')}
                  hint={form.strictHostKeyChecking === 'no' || form.strictHostKeyChecking === 'off' ? undefined : t('config.strictHint')}
                  validationState={form.strictHostKeyChecking === 'no' || form.strictHostKeyChecking === 'off' ? 'warning' : 'none'}
                  validationMessage={form.strictHostKeyChecking === 'no' || form.strictHostKeyChecking === 'off' ? t('config.strictNoWarn') : undefined}
                >
                  <Dropdown
                    value={form.strictHostKeyChecking ? STRICT_LABELS[form.strictHostKeyChecking]() : t('config.unset')}
                    selectedOptions={[form.strictHostKeyChecking]}
                    onOptionSelect={(_e, d) => set('strictHostKeyChecking', (d.optionValue ?? '') as FormState['strictHostKeyChecking'])}
                    data-testid="cfg-strict"
                  >
                    <Option value="" text={t('config.unset')}>
                      {t('config.unset')}
                    </Option>
                    {(form.strictHostKeyChecking === 'off' ? STRICT_OPTIONS_WITH_OFF : STRICT_OPTIONS).map((v) => (
                      <Option key={v} value={v} text={STRICT_LABELS[v]()}>
                        {STRICT_LABELS[v]()}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label={t('config.identityFile')} hint={form.extraIdentityFiles.length ? t('config.identityOthers', { files: form.extraIdentityFiles.join(', ') }) : undefined}>
                  <Dropdown
                    value={identityOptions.find((o) => o.value === form.identityFile)?.label ?? t('config.identityNone')}
                    selectedOptions={[form.identityFile]}
                    onOptionSelect={(_e, d) => set('identityFile', d.optionValue ?? '')}
                    data-testid="cfg-identity"
                  >
                    <Option value="">{t('config.identityNone')}</Option>
                    {identityOptions.map((o) => (
                      <Option key={o.value} value={o.value} text={o.label}>
                        {o.label}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                {current && current.otherDirectives.length ? (
                  <Field label={t('config.others')}>
                    <pre className={s.others}>{current.otherDirectives.map((d) => `${d.key} ${d.value}`).join('\n')}</pre>
                  </Field>
                ) : null}
                <div className={s.actions}>
                  <Button appearance="primary" icon={<Save20Regular />} disabled={!form.patterns.trim() || portInvalid} onClick={() => void save()} data-testid="cfg-save">
                    {t('config.save')}
                  </Button>
                  {typeof selected === 'number' ? (
                    <Button icon={<Delete20Regular />} onClick={() => void openDiff([{ op: 'delete', index: selected }])} data-testid="cfg-delete">
                      {t('config.deleteHost')}
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <DiffDialog open={pending !== null} before={pending?.preview.before ?? ''} after={pending?.preview.after ?? ''} onCancel={() => setPending(null)} onConfirm={confirmWrite} />
    </div>
  );
}
