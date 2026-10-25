import { z } from 'zod';

export const APP_NAME = 'SyncWave';
export const modeSchema = z.enum(['collaborative', 'host', 'hybrid']);
export type Mode = z.infer<typeof modeSchema>;
export const joinSchema = z
  .object({
    roomId: z.string().regex(/^[a-zA-Z0-9_-]{24}$/),
    name: z.string().trim().min(1).max(24),
    token: z.string().min(20).max(128),
    password: z.string().max(128).optional(),
  })
  .strict();
export const createSchema = z
  .object({ name: z.string().trim().min(1).max(60), password: z.string().max(128).optional() })
  .strict();
const envelope = { id: z.string().uuid(), baseVersion: z.number().int().nonnegative() };
const videoSchema = z.string().regex(/^[\w-]{11}$/);
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('play') }),
  z.object({ ...envelope, type: z.literal('pause') }),
  z.object({ ...envelope, type: z.literal('seek'), position: z.number().min(0).max(604800) }),
  z.object({
    ...envelope,
    type: z.literal('rate'),
    rate: z.union([
      z.literal(0.5),
      z.literal(0.75),
      z.literal(1),
      z.literal(1.25),
      z.literal(1.5),
      z.literal(2),
    ]),
  }),
  z.object({ ...envelope, type: z.literal('add'), videoId: videoSchema }),
  z.object({ ...envelope, type: z.literal('select'), itemId: z.string().uuid() }),
  z.object({ ...envelope, type: z.literal('remove'), itemId: z.string().uuid() }),
  z.object({
    ...envelope,
    type: z.literal('move'),
    itemId: z.string().uuid(),
    direction: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.object({ ...envelope, type: z.literal('next') }),
  z.object({ ...envelope, type: z.literal('previous') }),
  z.object({ ...envelope, type: z.literal('ended'), videoId: videoSchema }),
  z.object({
    ...envelope,
    type: z.literal('settings'),
    mode: modeSchema,
    queueEveryone: z.boolean(),
  }),
  z.object({ ...envelope, type: z.literal('transfer'), participantId: z.string() }),
]);
export type Command = z.infer<typeof commandSchema>;
export type Action = Command extends infer C
  ? C extends Command
    ? Omit<C, 'id' | 'baseVersion'>
    : never
  : never;
export type Participant = { id: string; name: string; online: boolean };
export type QueueItem = { id: string; videoId: string; title: string; addedBy: string };
export type Message = {
  id: string;
  name: string;
  text: string;
  at: number;
  senderId?: string;
  clientId?: string;
  system?: boolean;
};
export type ChatEnvelope = { roomId: string; message: Message };
export const chatSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    text: z
      .string()
      .max(500)
      .transform((text) =>
        Array.from(text.replace(/\r\n?/g, '\n'))
          .filter((char) => {
            const code = char.codePointAt(0)!;
            return (code >= 32 && code !== 127) || char === '\n' || char === '\t';
          })
          .join(''),
      )
      .pipe(z.string().trim().min(1).max(500)),
  })
  .strict();
export type RoomState = {
  id: string;
  name: string;
  version: number;
  videoId: string | null;
  currentId: string | null;
  playing: boolean;
  position: number;
  rate: number;
  updatedAt: number;
  hostId: string | null;
  mode: Mode;
  queueEveryone: boolean;
  queue: QueueItem[];
  participants: Participant[];
  messages: Message[];
  lastCommand?: { id: string; source: string; type: string };
};
export type Reply = {
  ok: boolean;
  error?: string;
  state?: RoomState;
  participantId?: string;
  roomId?: string;
  message?: Message;
};
export interface ClientEvents {
  create: (input: z.infer<typeof createSchema>, ack: (reply: Reply) => void) => void;
  join: (input: z.infer<typeof joinSchema>, ack: (reply: Reply) => void) => void;
  command: (input: Command, ack: (reply: Reply) => void) => void;
  refresh: (ack: (reply: Reply) => void) => void;
  clock: (ack: (time: number) => void) => void;
  chat: (input: z.input<typeof chatSchema>, ack: (reply: Reply) => void) => void;
  reaction: (input: string) => void;
  leave: (ack: () => void) => void;
}
export interface ServerEvents {
  state: (state: RoomState) => void;
  'chat:message': (data: ChatEnvelope) => void;
  reaction: (data: { emoji: string; name: string }) => void;
}
