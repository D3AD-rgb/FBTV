import { signal } from '@preact/signals';

const message = signal<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, ms = 2600): void {
  message.value = text;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    message.value = null;
  }, ms);
}

export function Toast() {
  return message.value ? (
    <div class="toast" role="status">
      {message.value}
    </div>
  ) : null;
}
