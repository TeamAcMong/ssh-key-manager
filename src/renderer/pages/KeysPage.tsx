import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Divider,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Option,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableCellLayout,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  Title3,
  Toolbar,
  ToolbarButton,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  Add20Regular,
  ArrowSync20Regular,
  ArrowUpload20Regular,
  Copy20Regular,
  Delete20Regular,
  Dismiss16Regular,
  KeyMultipleRegular,
  LockClosed16Regular,
  Rename20Regular,
  Save20Regular,
  Search20Regular,
  SearchRegular,
  ShieldCheckmark20Regular,
  ShieldKeyhole20Regular,
  ShieldKeyholeRegular,
  Warning16Filled
} from '@fluentui/react-icons';
import type { DetectedKeyType, KeyDetail, KeyInfo, SkmErrorData } from '../../core/types';
import { t } from '../i18n/t';
import { api, call, errorData } from '../lib/api';
import { isMac, isModKey, modLabel } from '../lib/platform';
import { CopyTextButton, EmptyState, ErrorCard, Mono, useNotify } from '../components/common';
import { ChangePassphraseDialog, RenameDialog } from '../components/KeyDialogs';

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: tokens.spacingVerticalS, padding: tokens.spacingVerticalM, boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  title: { marginRight: 'auto' },
  filters: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'center' },
  search: { flexGrow: 1, minWidth: '160px' },
  dropdown: { minWidth: '110px', width: '120px' },
  body: { display: 'flex', gap: tokens.spacingHorizontalM, flexGrow: 1, minHeight: 0 },
  list: {
    flex: '1 1 0',
    minWidth: '490px',
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    position: 'relative',
    backgroundColor: tokens.colorNeutralBackground1
  },
  dragging: { border: `2px dashed ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  dropHint: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForeground1
  },
  detail: {
    flex: '0 1 420px',
    minWidth: '280px',
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    boxSizing: 'border-box',
    backgroundColor: tokens.colorNeutralBackground1
  },
  row: { cursor: 'default' },
  nameCell: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, minWidth: 0 },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  tags: { display: 'flex', gap: tokens.spacingHorizontalXXS, flexWrap: 'wrap' },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
  inline: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  grow: { flexGrow: 1, minWidth: 0 },
  box: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingVerticalS, backgroundColor: tokens.colorNeutralBackground3, alignSelf: 'flex-start' },
  meta: { display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalXS },
  label: { color: tokens.colorNeutralForeground3 },
  badges: { display: 'flex', gap: tokens.spacingHorizontalXS, flexWrap: 'wrap' },
  toolbar: { flexWrap: 'wrap', padding: 0 },
  deleteBtn: { color: tokens.colorPaletteRedForeground1 }
});

type SortKey = 'name' | 'type' | 'bits' | 'created';
const TYPE_LABEL: Record<DetectedKeyType, string> = {
  ed25519: 'ED25519',
  rsa: 'RSA',
  ecdsa: 'ECDSA',
  dsa: 'DSA',
  'ed25519-sk': 'ED25519-SK',
  'ecdsa-sk': 'ECDSA-SK',
  unknown: '?'
};

function shortFp(fp: string | null): string {
  if (!fp) return '—';
  const body = fp.replace(/^SHA256:/, '');
  return body.length > 12 ? `${body.slice(0, 12)}…` : body;
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function KeysPage(props: {
  refreshSignal: number;
  dialogOpen: boolean;
  onNewKey: () => void;
  onAddToAgent: (key: KeyInfo) => void;
}): JSX.Element {
  const s = useStyles();
  const notify = useNotify();
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SkmErrorData | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedDetail, setDetail] = useState<KeyDetail | null>(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passKey, setPassKey] = useState<KeyInfo | null>(null);
  const [renameKey, setRenameKey] = useState<KeyInfo | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const list = await call(api().keys.list());
      setKeys(list);
    } catch (e) {
      setError(errorData(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, props.refreshSignal]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    call(api().keys.detail(selectedId))
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setTags(d.tags);
        setNotes(d.notes);
      })
      .catch((e: unknown) => alive && setError(errorData(e)));
    return () => {
      alive = false;
    };
  }, [selectedId, keys]);

  const allTags = useMemo(() => [...new Set(keys.flatMap((k) => k.tags))].sort(), [keys]);
  const allTypes = useMemo(() => [...new Set(keys.map((k) => k.type))].sort(), [keys]);
  const unsafe = keys.filter((k) => k.aclSafe === false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = keys.filter(
      (k) =>
        (!q || k.id.toLowerCase().includes(q) || k.comment.toLowerCase().includes(q) || (k.fingerprint ?? '').toLowerCase().includes(q)) &&
        (!tagFilter || k.tags.includes(tagFilter)) &&
        (!typeFilter || k.type === typeFilter)
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (k: KeyInfo): string | number =>
      sort.key === 'name' ? k.id.toLowerCase() : sort.key === 'type' ? k.type : sort.key === 'bits' ? (k.bits ?? 0) : (k.createdAt ?? '');
    return [...filtered].sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
  }, [keys, search, tagFilter, typeFilter, sort]);

  const selected = keys.find((k) => k.id === selectedId) ?? null;
  // Never show (or act on) a previous key while the newly selected one is still loading.
  const detail = loadedDetail && loadedDetail.id === selectedId ? loadedDetail : null;

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorData(e));
    } finally {
      setBusy(false);
    }
  };

  const copyPublic = (id: string): Promise<void> =>
    run(async () => {
      await call(api().keys.copyPublic(id));
      notify.success(t('common.copied'));
    });

  const remove = (id: string): Promise<void> =>
    run(async () => {
      const r = await call(api().keys.delete(id));
      if (r.deleted) {
        notify.success(t('detail.deleted', { name: id }));
        setSelectedId(null);
        await load();
      }
    });

  const fixPerms = (ids: string[] | 'all'): Promise<void> =>
    run(async () => {
      const unsafeCount = unsafe.length;
      await call(api().keys.fixPerms(ids));
      notify.success(ids === 'all' ? t('keys.fixedAll', { n: unsafeCount }) : t('detail.permsFixed', { name: ids.join(', ') }));
      await load();
    });

  const importFiles = (files: FileList): Promise<void> =>
    run(async () => {
      let last: string | null = null;
      for (const f of Array.from(files)) {
        const info = await call(api().keys.import(api().pathForFile(f)));
        notify.success(t('keys.imported', { name: info.id }));
        last = info.id;
      }
      await load();
      if (last) setSelectedId(last);
    });

  // Page-level shortcuts: Ctrl/Cmd+Shift+C copy public key, Del (Cmd+Backspace on macOS) delete; both need a selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (props.dialogOpen || passKey || renameKey || !selectedId) return;
      if (isModKey(e) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void copyPublic(selectedId);
      } else if ((e.key === 'Delete' || (isMac() && e.metaKey && e.key === 'Backspace')) && !isTyping(e)) {
        e.preventDefault();
        void remove(selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const headerCell = (key: SortKey, label: string, width?: string): JSX.Element => (
    <TableHeaderCell
      style={width ? { width } : undefined}
      sortDirection={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      onClick={() => setSort((p) => ({ key, dir: p.key === key && p.dir === 'asc' ? 'desc' : 'asc' }))}
    >
      {label}
    </TableHeaderCell>
  );

  const addTag = (): void => {
    const v = tagInput.trim();
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setTagInput('');
  };

  return (
    <div className={s.page}>
      <div className={s.header}>
        <Title3 className={s.title}>{t('keys.title')}</Title3>
        <Button appearance="primary" icon={<Add20Regular />} onClick={props.onNewKey} data-testid="new-key">
          {t('keys.new')}
        </Button>
        <Tooltip content={t('common.refresh')} relationship="label">
          <Button icon={loading ? <Spinner size="tiny" /> : <ArrowSync20Regular />} onClick={() => void load()} />
        </Tooltip>
      </div>

      {unsafe.length > 0 ? (
        <MessageBar intent="warning" data-testid="unsafe-banner">
          <MessageBarBody>{t('keys.unsafeBanner', { n: unsafe.length })}</MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => void fixPerms('all')} disabled={busy}>
              {t('keys.fixAll')}
            </Button>
          </MessageBarActions>
        </MessageBar>
      ) : null}
      {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}
      {warning ? (
        <MessageBar intent="warning">
          <MessageBarBody>{warning}</MessageBarBody>
          <MessageBarActions containerAction={<Button appearance="transparent" icon={<Dismiss16Regular />} aria-label={t('common.close')} onClick={() => setWarning(null)} />} />
        </MessageBar>
      ) : null}

      <div className={s.filters}>
        <Input className={s.search} contentBefore={<Search20Regular />} placeholder={t('keys.search')} value={search} onChange={(_e, d) => setSearch(d.value)} />
        <Dropdown className={s.dropdown} placeholder={t('keys.filter.tag')} value={tagFilter || t('keys.filter.tag')} selectedOptions={[tagFilter]} onOptionSelect={(_e, d) => setTagFilter(d.optionValue ?? '')}>
          <Option value="">{t('keys.filter.all')}</Option>
          {allTags.map((tg) => (
            <Option key={tg} value={tg}>
              {tg}
            </Option>
          ))}
        </Dropdown>
        <Dropdown
          className={s.dropdown}
          value={typeFilter ? TYPE_LABEL[typeFilter as DetectedKeyType] : t('keys.filter.type')}
          selectedOptions={[typeFilter]}
          onOptionSelect={(_e, d) => setTypeFilter(d.optionValue ?? '')}
        >
          <Option value="">{t('keys.filter.all')}</Option>
          {allTypes.map((ty) => (
            <Option key={ty} value={ty}>
              {TYPE_LABEL[ty]}
            </Option>
          ))}
        </Dropdown>
      </div>

      <div className={s.body}>
        <div
          className={mergeClasses(s.list, dragging && s.dragging)}
          data-testid="key-list"
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
          }}
        >
          {keys.length === 0 && !loading ? (
            <EmptyState
              icon={<KeyMultipleRegular fontSize={48} />}
              title={t('keys.empty.title')}
              body={t('keys.empty.body', { mod: modLabel() })}
              action={
                <Button appearance="primary" icon={<Add20Regular />} onClick={props.onNewKey}>
                  {t('keys.new')}
                </Button>
              }
            />
          ) : visible.length === 0 && !loading ? (
            <EmptyState icon={<SearchRegular fontSize={40} />} title={t('keys.noMatch')} />
          ) : (
            <Table size="small" aria-label={t('keys.title')} style={{ tableLayout: 'fixed' }}>
              <TableHeader>
                <TableRow>
                  {headerCell('name', t('keys.col.name'))}
                  {headerCell('type', t('keys.col.type'), '76px')}
                  {headerCell('bits', t('keys.col.bits'), '48px')}
                  <TableHeaderCell style={{ width: '96px' }}>{t('keys.col.fingerprint')}</TableHeaderCell>
                  <TableHeaderCell style={{ width: '84px' }}>{t('keys.col.tags')}</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((k) => (
                  <TableRow
                    key={k.id}
                    className={s.row}
                    aria-selected={k.id === selectedId}
                    appearance={k.id === selectedId ? 'brand' : 'none'}
                    onClick={() => setSelectedId(k.id)}
                    data-testid={`key-row-${k.id}`}
                  >
                    <TableCell>
                      <TableCellLayout truncate>
                        <span className={s.nameCell}>
                          <span className={s.ellipsis}>{k.id}</span>
                          {k.hasPassphrase ? (
                            <Tooltip content={t('keys.passphraseSet')} relationship="label">
                              <LockClosed16Regular />
                            </Tooltip>
                          ) : null}
                          {k.aclSafe === false ? (
                            <Tooltip content={t('keys.aclUnsafe')} relationship="label">
                              <Warning16Filled className={s.warn} data-testid="acl-warning" />
                            </Tooltip>
                          ) : null}
                        </span>
                      </TableCellLayout>
                    </TableCell>
                    <TableCell>{TYPE_LABEL[k.type]}</TableCell>
                    <TableCell>{k.bits ?? '—'}</TableCell>
                    <TableCell>
                      <span className={mergeClasses(s.mono, s.ellipsis)}>{shortFp(k.fingerprint)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={s.tags}>
                        {k.tags.slice(0, 2).map((tg) => (
                          <Badge key={tg} appearance="tint" size="small">
                            {tg}
                          </Badge>
                        ))}
                        {k.tags.length > 2 ? <Text size={100}>+{k.tags.length - 2}</Text> : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {dragging ? (
            <div className={s.dropHint}>
              <ArrowUpload20Regular /> {t('keys.drop')}
            </div>
          ) : null}
        </div>

        <aside className={s.detail} data-testid="key-detail">
          {!selected || !detail ? (
            <EmptyState icon={<ShieldKeyholeRegular fontSize={40} />} body={t('detail.empty')} />
          ) : (
            <>
              <div>
                <Title3 className={s.ellipsis} as="h2" block>
                  {detail.id}
                </Title3>
                <div className={s.badges}>
                  <Badge appearance="outline">
                    {TYPE_LABEL[detail.type]}
                    {detail.bits ? ` · ${detail.bits}` : ''}
                  </Badge>
                  {detail.hasPassphrase === true ? (
                    <Badge appearance="tint" color="success" icon={<LockClosed16Regular />}>
                      {t('keys.passphraseSet')}
                    </Badge>
                  ) : detail.hasPassphrase === false ? (
                    <Badge appearance="tint" color="warning">
                      {t('keys.noPassphrase')}
                    </Badge>
                  ) : null}
                  {detail.aclSafe === false ? (
                    <Badge appearance="tint" color="danger" icon={<Warning16Filled />}>
                      {t('keys.aclUnsafe')}
                    </Badge>
                  ) : detail.aclSafe === true ? (
                    <Badge appearance="tint" color="success" icon={<ShieldCheckmark20Regular />}>
                      {t('keys.aclSafe')}
                    </Badge>
                  ) : null}
                  {!detail.hasPrivate ? <Badge appearance="tint">{t('keys.publicOnly')}</Badge> : null}
                  {detail.hasPrivate && !detail.hasPublic ? <Badge appearance="tint">{t('keys.privateOnly')}</Badge> : null}
                </div>
              </div>

              {detail.error ? (
                <MessageBar intent="warning">
                  <MessageBarBody>{detail.error}</MessageBarBody>
                </MessageBar>
              ) : null}

              <Toolbar className={s.toolbar} size="small">
                <ToolbarButton icon={<LockClosed16Regular />} disabled={!detail.hasPrivate || busy} onClick={() => setPassKey(selected)}>
                  {t('detail.changePassphrase')}
                </ToolbarButton>
                <ToolbarButton icon={<Rename20Regular />} disabled={busy} onClick={() => setRenameKey(selected)}>
                  {t('detail.rename')}
                </ToolbarButton>
                <ToolbarButton icon={<ShieldKeyhole20Regular />} disabled={!detail.hasPrivate || busy} onClick={() => props.onAddToAgent(selected)}>
                  {t('detail.addToAgent')}
                </ToolbarButton>
                <ToolbarButton icon={<ShieldCheckmark20Regular />} disabled={detail.aclSafe !== false || busy} onClick={() => void fixPerms([detail.id])}>
                  {t('detail.fixPerms')}
                </ToolbarButton>
                <ToolbarButton className={s.deleteBtn} icon={<Delete20Regular />} disabled={busy} onClick={() => void remove(detail.id)} data-testid="delete-key">
                  {t('detail.delete')}
                </ToolbarButton>
              </Toolbar>
              <Divider />

              <Field label={t('detail.fingerprint')}>
                <div className={s.inline}>
                  <Text className={mergeClasses(s.mono, s.grow)} style={{ wordBreak: 'break-all' }} data-testid="detail-fingerprint">
                    {detail.fingerprint ?? '—'}
                  </Text>
                  {detail.fingerprint ? <CopyTextButton text={detail.fingerprint} onError={setError} /> : null}
                </div>
              </Field>

              <Field label={t('detail.publicKey')}>
                {detail.publicKey ? (
                  <div className={s.inline}>
                    <Textarea
                      className={s.grow}
                      readOnly
                      value={detail.publicKey}
                      resize="none"
                      rows={3}
                      textarea={{ style: { fontFamily: tokens.fontFamilyMonospace, fontSize: '12px' } }}
                      data-testid="detail-public-key"
                    />
                    <Tooltip content={`${t('common.copy')} (Ctrl+Shift+C)`} relationship="label">
                      <Button icon={<Copy20Regular />} onClick={() => void copyPublic(detail.id)} />
                    </Tooltip>
                  </div>
                ) : (
                  <Text>{t('detail.noPublicKey')}</Text>
                )}
              </Field>

              <div className={s.meta}>
                <Text className={s.label}>{t('detail.comment')}</Text>
                <Text>{detail.comment || t('detail.none')}</Text>
                <Text className={s.label}>{t('detail.created')}</Text>
                <Text>{detail.createdAt ? new Date(detail.createdAt).toLocaleString('vi-VN') : '—'}</Text>
              </div>

              {detail.randomart ? (
                <Field label={t('detail.randomart')}>
                  <div className={s.box}>
                    <Mono testId="detail-randomart" unbounded>{detail.randomart}</Mono>
                  </div>
                </Field>
              ) : null}

              {detail.fingerprint ? (
                <>
                  <Field label={t('detail.tags')}>
                    <div className={s.tags} style={{ marginBottom: tokens.spacingVerticalXS }}>
                      {tags.map((tg) => (
                        <Badge key={tg} appearance="tint" icon={<Dismiss16Regular />} iconPosition="after" onClick={() => setTags(tags.filter((x) => x !== tg))} style={{ cursor: 'pointer' }}>
                          {tg}
                        </Badge>
                      ))}
                    </div>
                    <Input
                      value={tagInput}
                      placeholder={t('detail.addTag')}
                      onChange={(_e, d) => setTagInput(d.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                    />
                  </Field>
                  <Field label={t('detail.notes')} hint={t('detail.notesHint')}>
                    <Textarea value={notes} onChange={(_e, d) => setNotes(d.value)} rows={3} maxLength={2000} />
                  </Field>
                  <Button
                    icon={<Save20Regular />}
                    style={{ alignSelf: 'flex-start' }}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await call(api().keys.setMeta(detail.id, tags, notes));
                        notify.success(t('common.saved'));
                        await load();
                      })
                    }
                  >
                    {t('detail.saveMeta')}
                  </Button>
                </>
              ) : null}
            </>
          )}
        </aside>
      </div>

      <ChangePassphraseDialog
        keyInfo={passKey}
        onClose={() => setPassKey(null)}
        onDone={(removed) => {
          setPassKey(null);
          notify.success(removed ? t('detail.passphraseRemoved') : t('detail.passphraseChanged'));
          void load();
        }}
      />
      <RenameDialog
        keyInfo={renameKey}
        onClose={() => setRenameKey(null)}
        onDone={(newId, hosts) => {
          setRenameKey(null);
          notify.success(t('detail.renamed', { name: newId }));
          setWarning(hosts.length ? t('detail.renameConfigWarn', { hosts: hosts.join(', ') }) : null);
          setSelectedId(newId);
          void load();
        }}
      />
    </div>
  );
}
