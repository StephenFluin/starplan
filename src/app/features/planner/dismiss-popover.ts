import { Directive, ElementRef, inject, output } from '@angular/core';

/**
 * Put on the element wrapping a popover and the button that opens it: emits when the user presses
 * Escape inside it (returning focus to that button) or presses anywhere outside it.
 */
@Directive({
  selector: '[appDismissPopover]',
  host: {
    '(document:pointerdown)': 'onPointerDown($event)',
    '(keydown.escape)': 'onEscape()',
  },
})
export class DismissPopover {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly appDismissPopover = output<void>();

  protected onPointerDown(event: PointerEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.appDismissPopover.emit();
  }

  protected onEscape(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[aria-expanded]')?.focus();
    this.appDismissPopover.emit();
  }
}
