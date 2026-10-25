import { CHAT_FADE_MS, CHAT_NOTIFICATION_MS, type FloatingMessage } from '../lib/chat';
import type { CSSProperties } from 'react';

export function ChatNotifications({
  items,
  announce = true,
}: {
  items: FloatingMessage[];
  announce?: boolean;
}) {
  return (
    <div
      className="player-chat-notifications"
      role="region"
      aria-label="Player chat notifications"
      aria-live={announce ? 'polite' : 'off'}
      aria-relevant="additions"
      style={
        {
          '--chat-duration': `${CHAT_NOTIFICATION_MS}ms`,
          '--chat-fade': `${CHAT_FADE_MS}ms`,
          '--chat-fade-delay': `${CHAT_NOTIFICATION_MS - CHAT_FADE_MS}ms`,
        } as CSSProperties
      }
    >
      {items.map(({ message }) => (
        <article className="player-chat-notification" key={message.id} data-message-id={message.id}>
          <span className="avatar color-1" aria-hidden="true">
            {message.name[0]?.toUpperCase()}
          </span>
          <div>
            <strong>{message.name}</strong>
            <p>{message.text}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
