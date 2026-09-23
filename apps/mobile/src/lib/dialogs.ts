import { Alert, Platform } from 'react-native';

// react-native-web does not implement Alert.alert, so every dialog goes through here.

export function showAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export function confirm(opts: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const { title, message, confirmText = 'OK', cancelText = 'Cancel', destructive } = opts;
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Shows an API or unknown error to the user. */
export function showError(err: unknown, title = 'Something went wrong') {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : undefined;
  showAlert(title, message);
}
