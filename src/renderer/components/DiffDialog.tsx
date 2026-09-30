import { useMemo, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Text, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import type { SkmErrorData } from '../../core/types';
import { t } from '../i18n/t';
import { errorData } from '../lib/api';
import { ErrorCard } from './common';
import { buildRows, type Row, type Side } from '../lib/diffRows';

const useStyles = makeStyles({
  surface: { width: '1000px', maxWidth: '94vw' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 40px 1fr',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: '55vh',
    overflow: 'auto'
  },
  head: { fontFamily: tokens.fontFamilyBase, fontWeight: tokens.fontWeightSemibold, padding: tokens.spacingVerticalXS, backgroundColor: tokens.colorNeutralBackground3, position: 'sticky', top: 0 },
  no: { color: tokens.colorNeutralForeground4, textAlign: 'right', paddingRight: tokens.spacingHorizontalS, userSelect: 'none' },
  cell: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', paddingLeft: tokens.spacingHorizontalXS, minHeight: '1.4em' },
  del: { backgroundColor: tokens.colorPaletteRedBackground2 },
  add: { backgroundColor: tokens.colorPaletteGreenBackground2 },
  empty: { backgroundColor: tokens.colorNeutralBackground4 },
  fold: { gridColumn: '1 / span 4', textAlign: 'center', color: tokens.colorNeutralForeground3, backgroundColor: tokens.colorNeutralBackground2, fontFamily: tokens.fontFamilyBase },
  note: { marginTop: tokens.spacingVerticalS, display: 'block', color: tokens.colorNeutralForeground3 }
});

export function DiffDialog(props: { open: boolean; before: string; after: string; onCancel: () => void; onConfirm: () => Promise<void> }): JSX.Element {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SkmErrorData | null>(null);
  const rows = useMemo(() => buildRows(props.before, props.after), [props.before, props.after]);
  const changed = props.before !== props.after;

  const cells = (side: Side, kind: Row['kind'], isLeft: boolean, key: string): JSX.Element[] => {
    const tint = kind === 'change' ? (side === null ? s.empty : isLeft ? s.del : s.add) : undefined;
    return [
      <span key={`${key}n`} className={mergeClasses(s.no, tint)}>
        {side?.no ?? ''}
      </span>,
      <span key={`${key}t`} className={mergeClasses(s.cell, tint)}>
        {side?.text ?? ''}
      </span>
    ];
  };

  return (
    <Dialog open={props.open} onOpenChange={(_e, d) => !d.open && !busy && props.onCancel()}>
      <DialogSurface className={s.surface} data-testid="diff-dialog">
        <DialogBody>
          <DialogTitle>{t('diff.title')}</DialogTitle>
          <DialogContent>
            {changed ? (
              <div className={s.grid}>
                <span className={s.head} style={{ gridColumn: '1 / span 2' }}>
                  {t('diff.before')}
                </span>
                <span className={s.head} style={{ gridColumn: '3 / span 2' }}>
                  {t('diff.after')}
                </span>
                {rows.flatMap((row, i) =>
                  row.kind === 'fold'
                    ? [
                        <span key={`f${i}`} className={s.fold}>
                          {t('diff.unchanged', { n: row.folded ?? 0 })}
                        </span>
                      ]
                    : [...cells(row.left, row.kind, true, `l${i}`), ...cells(row.right, row.kind, false, `r${i}`)]
                )}
              </div>
            ) : (
              <Text>{t('diff.noChange')}</Text>
            )}
            {props.before !== '' ? (
              <Text size={200} className={s.note}>
                {t('diff.backupNote')}
              </Text>
            ) : null}
            {error ? <ErrorCard error={error} onDismiss={() => setError(null)} /> : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={props.onCancel} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              appearance="primary"
              disabled={!changed || busy}
              data-testid="diff-confirm"
              icon={busy ? <Spinner size="tiny" /> : undefined}
              onClick={() => {
                setBusy(true);
                setError(null);
                props
                  .onConfirm()
                  .catch((e: unknown) => setError(errorData(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {t('diff.confirm')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
