import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Dropdown,
  Field,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title3,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import { Add20Regular, Delete20Regular, Play20Regular, ShieldKeyholeRegular, ShieldRegular } from '@fluentui/react-icons';
import type { AgentKey, AgentServiceStatus, AgentStartResult, KeyInfo, SkmErrorData } from '../../core/types';
import { t, type MessageKey } from '../i18n/t';
import { api, call, errorData } from '../lib/api';
import { isMac } from '../lib/platform';
import { CopyTextButton, EmptyState, ErrorCard, Mono, useNotify } from '../components/common';

const useStyles = makeStyles({
  page: { padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, height: '100%', overflow: 'auto', boxSizing: 'border-box' },
  card: { padding: tokens.spacingVerticalM },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, flexWrap: 'wrap' },
  grow: { flexGrow: 1 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, whiteSpace: 'nowrap' },
  cmd: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, marginTop: tokens.spacingVerticalS },
  cmdBox: { flexGrow: 1, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingVerticalXS, backgroundColor: tokens.colorNeutralBackground3 },
  list: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, minHeight: '180px' },
  picker: { minWidth: '280px' }
});

const COLOR: Record<AgentServiceStatus['state'], 'success' | 'informative' | 'danger' | 'warning'> = {
  running: 'success',
  stopped: 'informative',
  disabled: 'danger',
  'not-installed': 'danger',
  unknown: 'warning'
};

export function AgentPage(props: {
  refreshSignal: number;
  onAddToAgent: (key: KeyInfo) => void;
  onStatusChanged: () => void;
}): JSX.Element {
  const s = useStyles();
  const notify = useNotify();
  const [status, setStatus] = useState<AgentServiceStatus | null>(null);
  const [loaded, setLoaded] = useState<AgentKey[] | null>(null);
  const [inventory, setInventory] = useState<KeyInfo[]>([]);
  const [pick, setPick] = useState('');
  const [start, setStart] = useState<AgentStartResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SkmErrorData | null>(null);

  const { onStatusChanged } = props;
  const load = useCallback(async (): Promise<void> => {
    try {
      const st = await call(api().agent.status());
      setStatus(st);
      setLoaded(st.state === 'running' ? await call(api().agent.list()) : null);
      setInventory((await call(api().keys.list())).filter((k) => k.hasPrivate));
    } catch (e) {
      setError(errorData(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, props.refreshSignal]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorData(e));
    } finally {
      setBusy(false);
      onStatusChanged();
    }
  };

  const running = status?.state === 'running';
  const pickedKey = inventory.find((k) => k.id === pick) ?? null;

  return (
    <div className={s.page} data-testid="agent-page">
      <Title3>{t('agent.title')}</Title3>
      {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}

      <Card className={s.card}>
        <div className={s.row}>
          <ShieldRegular fontSize={28} />
          <div className={s.grow}>
            <Text weight="semibold" block>
              {isMac() ? t('agent.service.mac') : t('agent.service')}
            </Text>
            {isMac() ? null : (
              <Text size={200}>
                {t('agent.startType')}: {status?.startType ?? '—'}
              </Text>
            )}
          </div>
          <Badge appearance="filled" color={COLOR[status?.state ?? 'unknown']} data-testid="agent-state">
            {t(`status.agent.${status?.state ?? 'unknown'}` as MessageKey)}
          </Badge>
          <Button
            appearance="primary"
            icon={busy ? <Spinner size="tiny" /> : <Play20Regular />}
            disabled={busy || running || status?.state === 'not-installed'}
            data-testid="agent-start"
            onClick={() =>
              void run(async () => {
                const r = await call(api().agent.start());
                setStart(r);
                if (r.started) notify.success(t('agent.started'));
                await load();
              })
            }
          >
            {busy ? t('agent.starting') : t('agent.start')}
          </Button>
        </div>
        {start?.needsAdmin ? (
          <MessageBar intent="warning" layout="multiline" data-testid="agent-admin">
            <MessageBarBody>
              <MessageBarTitle>{t('agent.needsAdmin')}</MessageBarTitle>
              {start.messageVi} {t('agent.adminHelp')}
              {start.adminCommand ? (
                <div className={s.cmd}>
                  <div className={s.cmdBox}>
                    <Mono>{start.adminCommand}</Mono>
                  </div>
                  <CopyTextButton text={start.adminCommand} onError={setError} />
                </div>
              ) : null}
              <Button
                style={{ marginTop: tokens.spacingVerticalS }}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const st = await call(api().agent.enableAsAdmin());
                    setStatus(st);
                    if (st.state === 'running') {
                      setStart(null);
                      notify.success(t('agent.started'));
                    }
                    await load();
                  })
                }
              >
                {t('agent.enableAdmin')}
              </Button>
            </MessageBarBody>
          </MessageBar>
        ) : null}
        {start && !start.started && !start.needsAdmin ? (
          // macOS: launchd owns the agent, so the fix is a Terminal command the user runs (no elevation).
          <MessageBar intent="warning" layout="multiline" data-testid="agent-terminal">
            <MessageBarBody>
              <MessageBarTitle>{t('agent.notStarted')}</MessageBarTitle>
              {start.messageVi}
              {start.adminCommand ? (
                <div className={s.cmd}>
                  <div className={s.cmdBox}>
                    <Mono>{start.adminCommand}</Mono>
                  </div>
                  <CopyTextButton text={start.adminCommand} onError={setError} />
                </div>
              ) : null}
            </MessageBarBody>
          </MessageBar>
        ) : null}
      </Card>

      <MessageBar intent="info">
        <MessageBarBody>{isMac() ? t('agent.persistWarn.mac') : t('agent.persistWarn')}</MessageBarBody>
      </MessageBar>

      <Text weight="semibold">{t('agent.loaded')}</Text>
      <div className={s.list}>
        {!running ? (
          <EmptyState icon={<ShieldKeyholeRegular fontSize={40} />} title={t('agent.notRunning')} body={t('agent.notRunningBody')} />
        ) : loaded && loaded.length === 0 ? (
          <EmptyState icon={<ShieldKeyholeRegular fontSize={40} />} title={t('agent.empty')} body={t('agent.emptyBody')} />
        ) : (
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell style={{ width: '90px' }}>{t('keys.col.type')}</TableHeaderCell>
                <TableHeaderCell style={{ width: '60px' }}>{t('keys.col.bits')}</TableHeaderCell>
                <TableHeaderCell>{t('keys.col.fingerprint')}</TableHeaderCell>
                <TableHeaderCell>{t('agent.col.comment')}</TableHeaderCell>
                <TableHeaderCell style={{ width: '90px' }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(loaded ?? []).map((k) => (
                <TableRow key={k.fingerprint} data-testid={`agent-key-${k.fingerprint}`}>
                  <TableCell>{k.type.toUpperCase()}</TableCell>
                  <TableCell>{k.bits ?? '—'}</TableCell>
                  <TableCell>
                    <span className={s.mono}>{k.fingerprint}</span>
                  </TableCell>
                  <TableCell>{k.comment}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      icon={<Delete20Regular />}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await call(api().agent.remove(k.fingerprint));
                          notify.success(t('agent.removed'));
                          await load();
                        })
                      }
                    >
                      {t('agent.remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Field label={t('agent.addPicker')}>
        <div className={s.row}>
          <Dropdown className={s.picker} data-testid="agent-pick" placeholder={t('agent.pickKey')} value={pick} selectedOptions={[pick]} onOptionSelect={(_e, d) => setPick(d.optionValue ?? '')} disabled={!running}>
            {inventory.map((k) => (
              <Option key={k.id} value={k.id}>
                {k.id}
              </Option>
            ))}
          </Dropdown>
          <Button icon={<Add20Regular />} data-testid="agent-add" disabled={!running || !pickedKey || busy} onClick={() => pickedKey && props.onAddToAgent(pickedKey)}>
            {t('agent.add')}
          </Button>
        </div>
      </Field>
    </div>
  );
}
