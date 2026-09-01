<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // User::factory(10)->create();

        // The name is what the dashboard greets, so it is the demo presenter's rather
        // than "Test User" — a walk-through that opens with "Hello, Test" reads as a
        // fixture on screen. `users.name` is only settable at registration, so getting
        // it right here is the only chance a seeded account gets.
        $user = User::factory()->create([
            'name' => 'Navod',
            'email' => 'test@example.com',
        ]);

        $this->callWith(DemoTimelineSeeder::class, ['user' => $user]);
        // After the timeline, not before: the plan derives from the trailing window of
        // snapshots, and the movement history reads each day's score off them.
        $this->callWith(DemoContentSeeder::class, ['user' => $user]);
    }
}
