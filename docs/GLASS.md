# How Glass works

Padel is played in a glass box. So is your rating.

Glass is CUATRO's skill rating: a number that describes how you actually play, built only from matches you actually played. This page explains the principles it runs on, the guarantees it makes, and the one thing it deliberately does not spell out.

## The scale

Glass runs from 1.00 to 7.00, always shown to two decimal places. It never goes above or below those bounds, and it is the same scale everywhere. There is no country in the maths, so your number means the same thing at any venue, in any city.

## You start Unrated

There is no questionnaire, no self-assessment slider, and no rounding up on day one. A new player is simply Unrated. Your number appears after your first three verified matches, which we call the Placement Trio. While you are placing, your rating moves in larger steps so it can find your level quickly. After that it settles into smaller, steadier movements, for life. There are no resets.

If you already hold a level elsewhere, you will be able to use it to seed your starting point. It only shapes where placement begins. It is never displayed as your Glass.

## It only moves when you play

Glass has no opinion about you between matches. There is no decay while you are on holiday, no admin adjustment, no appeal process that nudges numbers, and no way to pay to change anything. The only thing that moves a rating is verified play.

A match is verified when a real member of the other team confirms the score. Unverified matches never touch Glass. A walkover does not either: a no-show is a Reliability matter, not a skill matter. If a match is abandoned partway through, the games that were completed still count, because real padel happened.

## What moves it

Every movement is the product of a few plain factors, and each one is named in the explanation you see:

- **The result, against expectation.** Glass compares your team's average rating to theirs before the match. Beating a stronger pair moves you up further than beating a weaker one. Losing to a much stronger pair barely moves you at all, because that is what was expected.
- **The margin.** 6-0 6-1 says more than 7-6 in the third, so a decisive scoreline moves both sides further than a scrape.
- **Repetition counts for less.** The same four players meeting again and again within a month tells Glass less each time, so repeat fixtures carry less weight. You cannot farm a friendly.
- **How much Glass already knows about you.** While your confidence is low, your rating moves more, because there is more left to learn.

## Confidence

Confidence is how sure Glass is about your number, and it is shown next to your rating for exactly that reason. It grows only when you face opponents you have not faced before. Variety, not volume: play fifty matches against the same eight people and your confidence stays modest, and everyone can see that your number rests on a narrow diet. Confidence is also capped below 100 percent, permanently, because Glass never claims certainty about anyone.

## Confidence is not Reliability

CUATRO tracks two things that other apps blur into one. **Confidence** is about your rating: how much evidence sits behind the number. **Reliability** is about attendance: whether you turn up when you said you would. Turning up is a virtue, and your circle can see it, but it is not a skill signal, so it never moves Glass in either direction.

## The Ledger

Every movement of every rating is written to the Ledger at the moment it happens, in plain English. A typical line:

> +0.02 · beat a slightly stronger pair, comfortable margin · vs Jamie, Kat (first meeting, full weight)

The Ledger is append-only by construction. Entries are never edited and never deleted, and each one records the rating before, the change, and the rating after, which always add up exactly. It is not a screen bolted onto the rating. It is the storage model itself, which means transparency is not something we could quietly turn off later.

## What we publish, and what we do not

CUATRO's code is open, including the rating engine, and this page tells you every principle Glass runs on. What we do not do is publish a friendly walkthrough of the exact update formula, or treat its tuning values as a promise.

The reason is plain. A precise, stable, well-explained formula is a cheat sheet for sandbagging, the practice of keeping your rating low on purpose to win easier matches. The defences against that kind of gaming live in the tuning values, and they will change, quietly and without notice, whenever someone finds an angle. So the contract is the principles on this page plus the explanation on every line of your own Ledger. The parameters are not part of the contract, and reverse-engineering them buys you nothing durable.

## The guarantees

- Only verified play moves your rating. Nothing else ever will.
- Every movement is explained on your Ledger, in plain English, at the moment it happens.
- The Ledger is append-only. Nothing is rewritten, nothing disappears.
- You can never pay to change your number, and neither can anyone else.
- Attendance is not skill. Reliability and Glass never touch.
- The rating is free, and stays free forever.
- Your Glass travels with you. Any venue, any city, same number.
