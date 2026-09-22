export class Plugin {
  disposers: (() => void)[] = []
  tabs: unknown[] = []
  commands: unknown[] = []
  constructor(protected app: any, public manifest: any) {}
  register(dispose: () => void) { this.disposers.push(dispose) }
  registerSettingTab(tab: unknown) { this.tabs.push(tab) }
  registerCommand(command: { id: string; title: string }) {
    command.id = `${this.manifest.id}:${command.id}`
    command.title = `${this.manifest.name}: ${command.title}`
    this.commands.push(command)
  }
}
export class SidebarPanel {
  containerEl!: HTMLElement
  ribbonButton: unknown
  constructor(protected ribbon: any, protected sidebar: any) {}
  addRibbonButton(button: unknown) { this.ribbonButton = button }
  show() { this.sidebar.container.addPanel(this) }
  hide() { this.sidebar.container.removePanel(this) }
}
export class SettingTab {
  containerEl = document.createElement('div')
  onshow() {}
  onhide() {}
}
export class Modal {
  containerEl = document.createElement('div')
  body = document.createElement('div')
  private listeners: (() => void)[] = []
  constructor(_props: unknown) {
    this.containerEl.className = 'typ-modal__wrapper'
    this.containerEl.style.display = 'none'
    this.containerEl.append(this.body)
    document.body.append(this.containerEl)
  }
  setHeader(_text: string) { return this }
  setBody(build: (body: HTMLElement) => void) { build(this.body); return this }
  onClose(callback: () => void) { this.listeners.push(callback); return this }
  open() { this.containerEl.style.display = '' }
  close() { this.listeners.forEach(callback => callback()); this.containerEl.style.display = 'none' }
}
export const fs = { stat: async () => ({ isFile: () => true, isDirectory: () => false }), isDirectory: async () => true }
