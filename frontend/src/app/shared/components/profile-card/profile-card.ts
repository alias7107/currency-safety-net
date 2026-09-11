import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * A household profile presented as a native radio so keyboard and screen reader
 * behaviour comes from the platform. The public id (P1–P4) is shown only as a
 * secondary marker; the internal engine name is never displayed.
 */
@Component({
  selector: 'app-profile-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="profile-card" [class.is-selected]="selected()">
      <input
        class="profile-card__input"
        type="radio"
        [name]="groupName()"
        [value]="profileId()"
        [checked]="selected()"
        [attr.aria-describedby]="descriptionId()"
        (change)="selectedChange.emit(profileId())"
      />
      <span class="profile-card__body">
        <span class="profile-card__header">
          <span class="profile-card__title">{{ title() }}</span>
          <span class="profile-card__id" aria-hidden="true">{{ profileId() }}</span>
        </span>
        <span class="profile-card__summary" [id]="descriptionId()">{{ summary() }}</span>
        <span class="profile-card__chips">
          @for (chip of incomeChips(); track chip) {
            <span class="chip chip--income">{{ chip }}</span>
          }
          @for (chip of expenseChips(); track chip) {
            <span class="chip chip--expense">{{ chip }}</span>
          }
        </span>
      </span>
      <span class="profile-card__check" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
          <path
            d="M3 8.5l3.2 3.2L13 5"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </label>
  `,
})
export class ProfileCard {
  readonly profileId = input.required<string>();
  readonly title = input.required<string>();
  readonly summary = input.required<string>();
  readonly incomeChips = input<readonly string[]>([]);
  readonly expenseChips = input<readonly string[]>([]);
  readonly selected = input<boolean>(false);
  readonly groupName = input<string>('profile');

  readonly selectedChange = output<string>();

  protected descriptionId(): string {
    return `profile-${this.profileId()}-summary`;
  }
}
