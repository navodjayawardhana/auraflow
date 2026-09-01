# SUS instrument — AuraFlow (Appendix D)

Ten items, Brooke (1996), unchanged. Each is answered 1 = strongly disagree to
5 = strongly agree. Do **not** reword them — the 68 benchmark only applies to the
original wording.

| # | Statement |
|---|---|
| 1 | I think that I would like to use this system frequently. |
| 2 | I found the system unnecessarily complex. |
| 3 | I thought the system was easy to use. |
| 4 | I think that I would need the support of a technical person to be able to use this system. |
| 5 | I found the various functions in this system were well integrated. |
| 6 | I thought there was too much inconsistency in this system. |
| 7 | I would imagine that most people would learn to use this system very quickly. |
| 8 | I found the system very cumbersome to use. |
| 9 | I felt very confident using the system. |
| 10 | I needed to learn a lot of things before I could get going with this system. |

## The four scripted tasks

Give these in order, without help. Record wall-clock time per task and any point
where the participant hesitates or asks a question.

1. **Register** an account and reach the home screen.
2. **Log last night's sleep.**
3. **Read today's brief** and say, in your own words, what the app is recommending
   and what it is basing that on.
4. **Complete a movement session.**

Task 3 is the one that matters for §5.4's disclosure argument: if participants
cannot say what the recommendation rests on, the disclosure interface is not working.

## Procedure

- Five participants, each alone, on the same device and build.
- Read the consent form; record verbal consent; no personal data leaves the device.
- Say "think aloud, and I will not help unless you are stuck for a minute".
- Administer the ten SUS items immediately after task 4, before any discussion.
- Enter the answers into `sus-responses.csv`, then run:

```
python docs/report/score_sus.py docs/report/sus-responses.csv
```

## Reporting rule

At n = 5 report the mean **with** the SD and the range. A single mean from five
people is not an estimate anyone should trust, and saying so is worth more marks
than hiding it.
