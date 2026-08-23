import { MothershipItemSheet } from '../item/ItemSheetApp.js';
import { skillContext } from '../item/forms.js';
import SkillSheet from './SkillSheet.svelte';

export class MothershipSkillSheet extends MothershipItemSheet {
  static COMPONENT = SkillSheet;

  _context() {
    return skillContext(this.document);
  }
}
