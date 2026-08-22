<?php

namespace App\Http\Requests\Api\V1;

use App\Models\MealEntry;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreMealRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:1', 'max:120'],
            // 8000 is well past any single meal; it exists to catch a slipped decimal
            // rather than to police what anyone eats.
            'kcal' => ['required', 'integer', 'min:0', 'max:8000'],
            'source' => ['required', Rule::in([
                MealEntry::SOURCE_LOOKUP,
                MealEntry::SOURCE_ESTIMATE,
                MealEntry::SOURCE_PHOTO,
            ])],
            'barcode' => ['nullable', 'string', 'regex:/^\d{6,14}$/'],
            'protein_g' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'carbs_g' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'fat_g' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'portion_g' => ['nullable', 'integer', 'min:1', 'max:5000'],
            'eaten_at' => ['nullable', 'date', 'before_or_equal:now'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                // A row claiming to come from a food database, with no product behind it,
                // would let a guess be displayed with the authority of a measurement.
                if ($this->input('source') === MealEntry::SOURCE_LOOKUP && ! $this->filled('barcode')) {
                    $validator->errors()->add(
                        'barcode',
                        'A looked-up meal must carry the barcode it was looked up from.',
                    );
                }

                // The mirror image of the rule above. A barcode on a photo estimate would
                // let a guess inherit the provenance of a scanned product.
                if ($this->input('source') === MealEntry::SOURCE_PHOTO && $this->filled('barcode')) {
                    $validator->errors()->add(
                        'barcode',
                        'A photo estimate is not a barcode lookup.',
                    );
                }
            },
        ];
    }
}
