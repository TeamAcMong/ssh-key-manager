import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import type { KeyDetail, KeyType, SkmErrorData } from '../../core/types';
import { t } from '../i18n/t';
import { api, call, errorData } from '../lib/api';
import { CopyTextButton, ErrorCard, Mono, PassphraseField, StrengthMeter, useNotify } from './common';

const useStyles = makeStyles({
  surface: { width: '640px', maxWidth: '92vw' },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  types: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: tokens.spacingHorizontalS },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalXS,
    display: 'flex',
    flexDirection: 'column'
  },
  cardSelected: { border: `2px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  hint: { paddingLeft: '32px', color: tokens.colorNeutralForeground3 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: tokens.spacingHorizontalM, alignItems: 'start' },
  result: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  box: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground3
  },
  inline: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  grow: { flexGrow: 1, minWidth: 0 }
});

const TYPES: { id: KeyType; label: string; hint: 'gen.ed25519.hint' | 'gen.rsa.hint' | 'gen.ecdsa.hint' }[] = [
  { id: 'ed25519', label: 'Ed25519', hint: 'gen.ed25519.hint' },
  { id: 'rsa', label: 'RSA', hint: 'gen.rsa.hint' },
  { id: 'ecdsa', label: 'ECDSA', hint: 'gen.ecdsa.hint' }
];
const BITS: Record<KeyType, number[]> = { ed25519: [], rsa: [3072, 4096], ecdsa: [256, 384, 521] };

function suggestName(type: KeyType, label: string): string {
  const clean = label.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean ? `id_${type}_${clean}` : `id_${type}`;
}

export function GenerateDialog(props: {
  open: boolean;
  defaultComment: string;
  onClose: () => void;
  onCreated: (key: KeyDetail) => void;
  onAddToAgent: (key: KeyDetail) => void;
  onCreateHost: (key: KeyDetail) => void;
}): JSX.Element {
  const s = useStyles();
  const notify = useNotify();
  const [type, setType] = useState<KeyType>('ed25519');
  const [bits, setBits] = useState<number>(3072);
  const [label, setLabel] = useState('');
  const [comment, setComment] = useState(props.defaultComment);
  const [fileName, setFileName] = useState(suggestName('ed25519', ''));
  const [nameTouched, setNameTouched] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SkmErrorData | null>(null);
  const [result, setResult] = useState<KeyDetail | null>(null);
  const checkSeq = useRef(0);

  // Reset everything (including secrets) whenever the dialog opens or closes.
  useEffect(() => {
    setType('ed25519');
    setBits(3072);
    setLabel('');
    setComment(props.defaultComment);
    setFileName(suggestName('ed25519', ''));
    setNameTouched(false);
    setPass('');
    setConfirm('');
    setError(null);
    setResult(null);
  }, [props.open, props.defaultComment]);

  useEffect(() => {
    if (!nameTouched) setFileName(suggestName(type, label));
  }, [type, label, nameTouched]);

  useEffect(() => {
    if (!props.open) return;
    const seq = ++checkSeq.current;
    const timer = setTimeout(() => {
      call(api().keys.checkName(fileName))
        .then((msg) => {
          if (seq === checkSeq.current) setNameError(msg);
        })
        .catch((e: unknown) => {
          if (seq === checkSeq.current) setNameError(errorData(e).messageVi);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [fileName, props.open]);

  const bitOptions = BITS[type];
  const selectedBits = bitOptions.includes(bits) ? bits : (bitOptions[0] ?? 0);
  const mismatch = confirm.length > 0 && pass !== confirm;
  const tooShort = pass.length > 0 && pass.length < 5;
  const canSubmit = !busy && !nameError && !mismatch && !tooShort && (pass === '' || pass === confirm) && comment.length <= 200;

  const submit = async (): Promise<void> => {
    const passphrase = pass;
    // Secrets leave React state immediately; only the local copy goes to main.
    setPass('');
    setConfirm('');
    setBusy(true);
    setError(null);
    try {
      const req = { type, comment, fileName, passphrase, ...(type === 'ed25519' ? {} : { bits: selectedBits }) };
      const key = await call(api().keys.generate(req));
      setResult(key);
      notify.success(t('gen.created', { name: key.id }));
      props.onCreated(key);
    } catch (e) {
      setError(errorData(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(_e, d) => !d.open && !busy && props.onClose()} modalType="modal">
      <DialogSurface className={s.surface} data-testid="generate-dialog">
        <DialogBody>
          <DialogTitle>{result ? t('gen.result') : t('gen.title')}</DialogTitle>
          <DialogContent>
            {result ? (
              <div className={s.result}>
                <Field label={t('detail.fingerprint')}>
                  <div className={s.inline}>
                    <Text font="monospace" className={s.grow} data-testid="result-fingerprint">
                      {result.fingerprint}
                    </Text>
                    <CopyTextButton text={result.fingerprint ?? ''} onError={setError} />
                  </div>
                </Field>
                {result.randomart ? (
                  <div className={s.box}>
                    <Mono unbounded>{result.randomart}</Mono>
                  </div>
                ) : null}
                <Field label={t('detail.publicKey')}>
                  <div className={s.inline}>
                    <Textarea className={s.grow} readOnly value={result.publicKey ?? ''} resize="none" rows={3} textarea={{ style: { fontFamily: tokens.fontFamilyMonospace, fontSize: '12px' } }} />
                    <CopyTextButton text={result.publicKey ?? ''} onError={setError} />
                  </div>
                </Field>
                {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}
              </div>
            ) : (
              <div className={s.form}>
                <Field label={t('gen.type')}>
                  <RadioGroup value={type} onChange={(_e, d) => setType(d.value as KeyType)} layout="horizontal" className={s.types}>
                    {TYPES.map((k) => (
                      <div key={k.id} className={type === k.id ? `${s.card} ${s.cardSelected}` : s.card}>
                        <Radio value={k.id} label={k.label} data-testid={`type-${k.id}`} />
                        <Text size={200} className={s.hint}>
                          {t(k.hint)}
                        </Text>
                      </div>
                    ))}
                  </RadioGroup>
                </Field>
                {bitOptions.length ? (
                  <Field label={t('gen.bits')}>
                    <Dropdown value={String(selectedBits)} selectedOptions={[String(selectedBits)]} onOptionSelect={(_e, d) => setBits(Number(d.optionValue))}>
                      {bitOptions.map((b) => (
                        <Option key={b} value={String(b)}>
                          {String(b)}
                        </Option>
                      ))}
                    </Dropdown>
                  </Field>
                ) : null}
                <div className={s.row}>
                  <Field label={t('gen.label')} hint={t('gen.labelHint')}>
                    <Input value={label} onChange={(_e, d) => setLabel(d.value)} data-testid="gen-label" />
                  </Field>
                  <Field label={t('gen.comment')}>
                    <Input value={comment} onChange={(_e, d) => setComment(d.value)} data-testid="gen-comment" />
                  </Field>
                </div>
                <Field
                  label={t('gen.fileName')}
                  validationState={nameError ? 'error' : 'success'}
                  validationMessage={nameError ?? t('gen.fileOk')}
                >
                  <Input
                    value={fileName}
                    data-testid="gen-filename"
                    onChange={(_e, d) => {
                      setNameTouched(true);
                      setFileName(d.value);
                    }}
                  />
                </Field>
                <div className={s.row}>
                  <PassphraseField label={t('gen.passphrase')} value={pass} onChange={setPass} testId="gen-pass" validationState={tooShort ? 'error' : 'none'} validationMessage={tooShort ? 'Tối thiểu 5 ký tự.' : undefined} />
                  <PassphraseField
                    label={t('gen.confirm')}
                    value={confirm}
                    onChange={setConfirm}
                    testId="gen-confirm"
                    validationState={mismatch ? 'error' : 'none'}
                    validationMessage={mismatch ? t('gen.mismatch') : undefined}
                  />
                </div>
                <StrengthMeter value={pass} />
                {pass === '' ? (
                  <MessageBar intent="warning">
                    <MessageBarBody>{t('gen.emptyWarn')}</MessageBarBody>
                  </MessageBar>
                ) : null}
                {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}
              </div>
            )}
          </DialogContent>
          <DialogActions fluid={result !== null} position="end">
            {result ? (
              <>
                <Button onClick={() => props.onAddToAgent(result)}>{t('gen.addAgent')}</Button>
                <Button onClick={() => props.onCreateHost(result)}>{t('gen.createHost')}</Button>
                <Button appearance="primary" onClick={props.onClose}>
                  {t('common.done')}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={props.onClose} disabled={busy}>
                  {t('common.cancel')}
                </Button>
                <Button appearance="primary" disabled={!canSubmit} onClick={() => void submit()} data-testid="gen-submit" icon={busy ? <Spinner size="tiny" /> : undefined}>
                  {busy ? t('gen.working') : t('gen.submit')}
                </Button>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
