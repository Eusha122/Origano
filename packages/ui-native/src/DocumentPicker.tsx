import { t } from '@oregano/i18n';
import { colors, layout, typeScale } from '@oregano/ui';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body } from './Body';
import { Button } from './Button';
import { useLocale } from './locale';
import { bodyFont } from './typography';

/**
 * A file to upload: a Blob on the web, the local uri with a name and type on a phone.
 * (The same shape the API client sends.)
 */
export type PickedFile = Blob | { uri: string; name: string; type: string };

type State = 'idle' | 'uploading' | 'failed';

/**
 * Chooses a photo and hands it over. The state of the upload is always written out, not shown by colour alone:
 * waiting, "Uploading…", "Photo added", or the reason it failed.
 */
export function DocumentPicker(props: {
  label: string;
  uploaded: boolean;
  onPick: (file: PickedFile) => Promise<void>;
  /** Turns a failure into words the person can act on. */
  describeError: (error: unknown) => string;
}) {
  const { locale } = useLocale();
  const [state, setState] = useState<State>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  const choose = async (): Promise<void> => {
    setFailure(null);
    let picked: Awaited<ReturnType<typeof launchImageLibraryAsync>>;
    try {
      picked = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    } catch (error) {
      setState('failed');
      setFailure(props.describeError(error));
      return;
    }
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;
    // On the web the picker hands over the real File; on a phone, the local uri.
    const file: PickedFile = asset.file ?? {
      uri: asset.uri,
      name: asset.fileName ?? 'photo.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    };
    setState('uploading');
    try {
      await props.onPick(file);
      setState('idle');
    } catch (error) {
      setState('failed');
      setFailure(props.describeError(error));
    }
  };

  const status =
    state === 'uploading'
      ? t(locale, 'apply.docUploading')
      : state === 'failed'
        ? failure
        : props.uploaded
          ? t(locale, 'apply.docUploaded')
          : t(locale, 'apply.docMissing');

  return (
    <View style={styles.box}>
      <Body strong>{props.label}</Body>
      <View role={state === 'failed' ? 'alert' : 'status'}>
        <Text style={[styles.status, { fontFamily: bodyFont(locale, state === 'failed') }]}>{status}</Text>
      </View>
      <Button
        label={t(locale, props.uploaded ? 'doc.change' : 'doc.choose')}
        variant="secondary"
        busy={state === 'uploading'}
        onPress={() => void choose()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: layout.screenMargin / 2,
    padding: layout.screenMargin * 0.75,
    borderRadius: layout.buttonRadius,
    borderWidth: layout.iconStroke,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  status: { color: colors.mutedPlum, fontSize: typeScale.caption.size },
});
