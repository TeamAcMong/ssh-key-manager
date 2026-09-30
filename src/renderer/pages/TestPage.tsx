import { useEffect, useRef, useState } from 'react';
import { Button, Combobox, Field, Input, MessageBar, MessageBarBody, MessageBarTitle, Option, Spinner, Text, Title3, makeStyles, tokens } from '@fluentui/react-components';
import { Play20Regular, Stop20Regular } from '@fluentui/react-icons';
import type { ConnectionTestResult, SkmErrorData } from '../../core/types';
import { t } from '../i18n/t';
import { api, call, errorData } from '../lib/api';
import { ErrorCard, useNotify } from '../components/common';
import type { PageId } from '../components/Shell';

const useStyles = makeStyles({
  page: { padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, height: '100%', boxSizing: 'border-box', minHeight: 0 },
  row: { display: 'flex', alignItems: 'flex-end', gap: tokens.spacingHorizontalS },
  host: { flexGrow: 1 },
  timeout: { width: '120px' },
  console: {
    flexGrow: 1,
    minHeight: '160px',
    margin: 0,
    overflow: 'auto',
    padding: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: '#1b1b1b',
    color: '#e6e6e6',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all'
  },
  stderr: { color: '#f5b76b' },
  muted: { color: '#9a9a9a' }
});

interface Chunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

/** Host aliases usable as a target: patterns without wildcards or negation. */
function concreteAliases(patterns: string[][]): string[] {
  return [...new Set(patterns.flat().filter((p) => !/[*?!]/.test(p)))];
}

export function TestPage(props: { onNavigate: (p: PageId) => void; onKeysChanged: () => void }): JSX.Element {
  const s = useStyles();
  const notify = useNotify();
  const [aliases, setAliases] = useState<string[]>([]);
  const [host, setHost] = useState('');
  const [timeout, setTimeoutSec] = useState('10');
  const [runId, setRunId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [error, setError] = useState<SkmErrorData | null>(null);
  const runRef = useRef<string | null>(null);
  const consoleRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    call(api().config.read())
      .then((c) => setAliases(concreteAliases(c.hosts.filter((h) => h.kind === 'host').map((h) => h.patterns))))
      .catch((e: unknown) => setError(errorData(e)));
  }, []);

  useEffect(() => {
    const offOut = api().test.onOutput((e) => {
      if (e.runId === runRef.current) setChunks((c) => [...c, { stream: e.stream, text: e.chunk }]);
    });
    const offDone = api().test.onDone((e) => {
      if (e.runId !== runRef.current) return;
      runRef.current = null;
      setRunId(null);
      setResult(e.result);
    });
    return () => {
      offOut();
      offDone();
    };
  }, []);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chunks]);

  const timeoutNum = Number(timeout);
  const timeoutValid = Number.isInteger(timeoutNum) && timeoutNum >= 1 && timeoutNum <= 120;

  const start = async (): Promise<void> => {
    setChunks([]);
    setResult(null);
    setError(null);
    try {
      const r = await call(api().test.run(host.trim(), timeoutNum));
      runRef.current = r.runId;
      setRunId(r.runId);
    } catch (e) {
      setError(errorData(e));
    }
  };

  const fixAction = (err: SkmErrorData): JSX.Element | undefined => {
    if (err.fix === 'fix-perms') {
      return (
        <Button
          size="small"
          onClick={() => {
            call(api().keys.fixPerms('all'))
              .then(() => {
                notify.success(t('test.permsFixed'));
                props.onKeysChanged();
              })
              .catch((e: unknown) => setError(errorData(e)));
          }}
        >
          {t('test.fix.perms')}
        </Button>
      );
    }
    if (err.fix === 'add-to-agent')
      return (
        <Button size="small" onClick={() => props.onNavigate('agent')}>
          {t('test.fix.agent')}
        </Button>
      );
    if (err.fix === 'start-agent')
      return (
        <Button size="small" onClick={() => props.onNavigate('agent')}>
          {t('test.fix.startAgent')}
        </Button>
      );
    return undefined;
  };

  return (
    <div className={s.page} data-testid="test-page">
      <Title3>{t('test.title')}</Title3>
      <div className={s.row}>
        <Field label={t('test.host')} className={s.host}>
          <Combobox
            freeform
            value={host}
            selectedOptions={aliases.includes(host) ? [host] : []}
            onChange={(e) => setHost((e.target as HTMLInputElement).value)}
            onOptionSelect={(_e, d) => setHost(d.optionValue ?? '')}
            placeholder="github-work / git@github.com"
            data-testid="test-host"
          >
            {aliases.map((a) => (
              <Option key={a} value={a}>
                {a}
              </Option>
            ))}
          </Combobox>
        </Field>
        <Field label={t('test.timeout')} className={s.timeout} validationState={timeoutValid ? 'none' : 'error'}>
          <Input value={timeout} onChange={(_e, d) => setTimeoutSec(d.value)} type="number" min={1} max={120} />
        </Field>
        {runId ? (
          <Button icon={<Stop20Regular />} onClick={() => void call(api().test.cancel(runId)).catch((e: unknown) => setError(errorData(e)))}>
            {t('test.cancel')}
          </Button>
        ) : (
          <Button appearance="primary" icon={<Play20Regular />} disabled={!host.trim() || !timeoutValid} onClick={() => void start()} data-testid="test-run">
            {t('test.run')}
          </Button>
        )}
      </div>

      {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}
      {runId ? (
        <Spinner size="tiny" label={t('test.running')} labelPosition="after" style={{ alignSelf: 'flex-start' }} />
      ) : null}
      {result ? (
        result.success ? (
          <MessageBar intent="success" data-testid="test-result">
            <MessageBarBody>
              <MessageBarTitle>{t('test.success', { ms: result.durationMs })}</MessageBarTitle>
            </MessageBarBody>
          </MessageBar>
        ) : result.error ? (
          <div data-testid="test-result">
            <ErrorCard error={result.error} action={fixAction(result.error)} />
          </div>
        ) : null
      ) : null}

      <Text weight="semibold">{t('test.output')}</Text>
      <pre className={s.console} ref={consoleRef} data-testid="test-console">
        {chunks.length === 0 ? (
          <span className={s.muted}>{t('test.outputEmpty')}</span>
        ) : (
          chunks.map((c, i) => (
            <span key={i} className={c.stream === 'stderr' ? s.stderr : undefined}>
              {c.text}
            </span>
          ))
        )}
      </pre>
    </div>
  );
}
