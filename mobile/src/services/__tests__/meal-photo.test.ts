import { summarise, withoutItem, type PhotoEstimateItem } from '@/services/meal-photo';

function item(overrides: Partial<PhotoEstimateItem> = {}): PhotoEstimateItem {
  return { name: 'Rice', kcal: 300, protein_g: null, carbs_g: null, fat_g: null, ...overrides };
}

/**
 * The arithmetic behind striking an item off the model's list.
 *
 * Worth its own test because it duplicates what the API already computed: the two have to
 * agree, or removing an item and removing nothing would produce different totals for the
 * same plate.
 */
describe('summarise', () => {
  it('adds the calories of every item', () => {
    const totals = summarise([item({ kcal: 300 }), item({ name: 'Dhal', kcal: 180 })]);

    expect(totals.kcal).toBe(480);
  });

  it('joins the item names into a meal name', () => {
    const totals = summarise([item({ name: 'Rice' }), item({ name: 'Dhal' })]);

    expect(totals.name).toBe('Rice, Dhal');
  });

  it('reports a macro as unknown when no item carried one', () => {
    // Not zero. Zero is a claim that the meal contains none of it.
    expect(summarise([item()]).protein_g).toBeNull();
  });

  it('sums a macro only over the items that reported it', () => {
    const totals = summarise([item({ protein_g: 6 }), item({ name: 'Curry', protein_g: null })]);

    expect(totals.protein_g).toBe(6);
  });

  it('cuts a long meal name to what the name column accepts', () => {
    const many = Array.from({ length: 10 }, (_, i) => item({ name: `Something rather long ${i}` }));

    const { name } = summarise(many);

    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('…')).toBe(true);
  });
});

describe('withoutItem', () => {
  it('drops only the item at the given position', () => {
    const items = [item({ name: 'Rice' }), item({ name: 'Dhal' }), item({ name: 'Papadum' })];

    expect(withoutItem(items, 1).map((i) => i.name)).toEqual(['Rice', 'Papadum']);
  });

  it('recomputes the totals without the removed item', () => {
    const items = [item({ kcal: 300, protein_g: 6 }), item({ kcal: 180, protein_g: 9 })];

    const totals = summarise(withoutItem(items, 0));

    expect(totals.kcal).toBe(180);
    expect(totals.protein_g).toBe(9);
  });
});
