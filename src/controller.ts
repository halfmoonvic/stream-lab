import { ChatController } from './core/chat-controller'

/** 应用级单例:所有组件通过 useStore 订阅它 */
export const controller = new ChatController()
