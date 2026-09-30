import { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Spinner, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { KeyInfo, SkmErrorData } from '../../core/types';
import { t } from '../i18n/t';
import { api, call, errorData } from '../lib/api';
import { ErrorCard, PassphraseField, StrengthMeter } from './common';

const useStyles = makeStyles({
  surface: { width: '480px', maxWidth: '92vw' },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM }
});

interface BaseProps {
  keyInfo: KeyInfo | null;
  onClose: () => void;
}

/** Shared shell: runs `action`, keeps the dialog open with an inline error on failure. */
function ActionDialog(props: {
  open: boolean;
  title: string;
  submitLabel: string;
  canSubmit: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: React.ReactNode;
  testId: string;
}): JSX.Element {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SkmErrorData | null>(null);
  useEffect(() => setError(null), [props.open]);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit();
    } catch (e) {
      setError(errorData(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={(_e, d) => !d.open && !busy && props.onClose()}>
      <DialogSurface className={s.surface} data-testid={props.testId}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (props.canSubmit && !busy) void submit();
          }}
        >
          <DialogBody>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogContent className={s.form}>
              {props.children}
              {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={props.onClose} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" appearance="primary" disabled={!props.canSubmit || busy} icon={busy ? <Spinner size="tiny" /> : undefined}>
                {props.submitLabel}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

export function ChangePassphraseDialog(props: BaseProps & { onDone: (removed: boolean) => void }): JSX.Element {
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  const [confirm, setConfirm] = useState('');
  const open = props.keyInfo !== null;
  useEffect(() => {
    setOldP('');
    setNewP('');
    setConfirm('');
  }, [open]);
  const needsOld = props.keyInfo?.hasPassphrase !== false;
  const mismatch = confirm.length > 0 && newP !== confirm;
  const tooShort = newP.length > 0 && newP.length < 5;
  return (
    <ActionDialog
      open={open}
      testId="passphrase-dialog"
      title={t('pass.title', { name: props.keyInfo?.id ?? '' })}
      submitLabel={t('pass.submit')}
      canSubmit={(!needsOld || oldP.length > 0) && newP === confirm && !tooShort}
      onClose={props.onClose}
      onSubmit={async () => {
        const o = oldP;
        const n = newP;
        setOldP('');
        setNewP('');
        setConfirm('');
        await call(api().keys.changePassphrase(props.keyInfo?.id ?? '', o, n));
        props.onDone(n === '');
      }}
    >
      {needsOld ? <PassphraseField label={t('pass.old')} value={oldP} onChange={setOldP} autoFocus /> : null}
      <PassphraseField label={t('pass.new')} value={newP} onChange={setNewP} validationState={tooShort ? 'error' : 'none'} validationMessage={tooShort ? 'Tối thiểu 5 ký tự.' : undefined} />
      <PassphraseField label={t('pass.confirm')} value={confirm} onChange={setConfirm} validationState={mismatch ? 'error' : 'none'} validationMessage={mismatch ? t('gen.mismatch') : undefined} />
      <StrengthMeter value={newP} />
    </ActionDialog>
  );
}

export function RenameDialog(props: BaseProps & { onDone: (newName: string, configHosts: string[]) => void }): JSX.Element {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const open = props.keyInfo !== null;
  useEffect(() => setName(props.keyInfo?.id.replace(/\.pub$/i, '') ?? ''), [props.keyInfo]);
  useEffect(() => {
    if (!open) return;
    const current = props.keyInfo?.id.replace(/\.pub$/i, '');
    if (name === current) {
      setNameError(null);
      return;
    }
    const timer = setTimeout(() => {
      call(api().keys.checkName(name))
        .then(setNameError)
        .catch((e: unknown) => setNameError(errorData(e).messageVi));
    }, 200);
    return () => clearTimeout(timer);
  }, [name, open, props.keyInfo]);
  return (
    <ActionDialog
      open={open}
      testId="rename-dialog"
      title={t('rename.title')}
      submitLabel={t('rename.submit')}
      canSubmit={!nameError && name.length > 0 && name !== props.keyInfo?.id.replace(/\.pub$/i, '')}
      onClose={props.onClose}
      onSubmit={async () => {
        const r = await call(api().keys.rename(props.keyInfo?.id ?? '', name));
        props.onDone(r.key.id, r.configReferences);
      }}
    >
      <Field label={t('rename.newName')} validationState={nameError ? 'error' : 'none'} validationMessage={nameError ?? undefined}>
        <Input value={name} onChange={(_e, d) => setName(d.value)} autoFocus />
      </Field>
    </ActionDialog>
  );
}

export function AgentPassphraseDialog(props: BaseProps & { onDone: () => void }): JSX.Element {
  const [pass, setPass] = useState('');
  const open = props.keyInfo !== null;
  useEffect(() => setPass(''), [open]);
  return (
    <ActionDialog
      open={open}
      testId="agent-pass-dialog"
      title={t('agentPass.title')}
      submitLabel={t('agentPass.submit')}
      canSubmit={pass.length > 0}
      onClose={props.onClose}
      onSubmit={async () => {
        const p = pass;
        setPass('');
        await call(api().agent.add(props.keyInfo?.id ?? '', p));
        props.onDone();
      }}
    >
      <Text>{t('agentPass.body', { name: props.keyInfo?.id ?? '' })}</Text>
      <PassphraseField label={t('gen.passphrase')} value={pass} onChange={setPass} autoFocus />
    </ActionDialog>
  );
}
