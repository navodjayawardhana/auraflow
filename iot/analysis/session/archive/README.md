# Archived: the 2026-08-12 pair

Two rows, and neither is usable as agreement evidence. They are kept rather than deleted
because a discarded measurement is still a record of what was tried.

```
        node    watch
        100      91
        113      83
```

Two problems, and the second is the one that matters.

**They are five minutes apart.** `validate_hr.py` pairs on a tolerance window for exactly
this reason — a resting heart rate can move thirty beats in five minutes, so two readings
taken at different moments say nothing about whether two devices agree.

**The logger had stopped recording.** `log_session.ps1` matched `hr=(-?\d+)\(1\)`, an
integer. When the streaming estimator began resolving a decimal the firmware started
printing `hr=93.4(1)`, the pattern stopped matching, and every reading after that was
dropped in silence. These two rows predate that change; there is nothing between them and
the day the pattern was fixed.

So the node is not known to be inaccurate. It is unmeasured, which is a different thing and
the one worth writing down.
