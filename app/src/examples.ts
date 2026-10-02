// Example scores from the test library, so you can try the app straight away.
import oldHundredthSolfa from '../../tests/fixtures/old-hundredth.solfa.txt?raw';
import oldHundredthStaff from '../../tests/fixtures/old-hundredth.staff.txt?raw';
import eveningSolfa from '../../tests/fixtures/evening-song.solfa.txt?raw';
import eveningStaff from '../../tests/fixtures/evening-song.staff.txt?raw';

export interface Example {
  name: string;
  format: 'solfa' | 'staff';
  text: string;
}

export const EXAMPLES: Example[] = [
  { name: 'Old Hundredth (sol-fa)', format: 'solfa', text: oldHundredthSolfa },
  { name: 'Old Hundredth (staff)', format: 'staff', text: oldHundredthStaff },
  { name: 'Evening Song — repeats, D.C. (sol-fa)', format: 'solfa', text: eveningSolfa },
  { name: 'Evening Song — repeats, D.C. (staff)', format: 'staff', text: eveningStaff },
];
