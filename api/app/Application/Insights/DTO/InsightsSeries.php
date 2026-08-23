<?php

namespace App\Application\Insights\DTO;

/**
 * A window, and every day in it -- including the empty ones.
 *
 * The empty days are the reason this walks the calendar rather than returning the rows it
 * found. A client handed only the days that have data cannot tell a fortnight with four
 * nights in it from four consecutive nights, and both of them would draw the same chart.
 */
final class InsightsSeries
{
    /** @param  list<InsightsDay>  $days */
    public function __construct(
        public readonly string $from,
        public readonly string $to,
        public readonly array $days,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'from' => $this->from,
            'to' => $this->to,
            // The count the client divides by. Sending it rather than letting the client
            // infer it from the array length means a truncated response cannot quietly
            // become a smaller window with better-looking coverage.
            'window_days' => count($this->days),
            'days' => array_map(static fn (InsightsDay $day) => $day->toArray(), $this->days),
        ];
    }
}
