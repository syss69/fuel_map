ALTER TABLE digest_subscriptions ADD COLUMN weekdays integer[] NOT NULL DEFAULT ARRAY[1,3,5];
ALTER TABLE digest_subscriptions ADD CONSTRAINT digest_weekdays CHECK (
  array_ndims(weekdays) = 1 AND array_lower(weekdays,1) = 1
  AND cardinality(weekdays) BETWEEN 1 AND 3
  AND weekdays <@ ARRAY[1,2,3,4,5,6,7]
  AND array_position(weekdays,NULL) IS NULL
  AND (cardinality(weekdays)<2 OR weekdays[1]<>weekdays[2])
  AND (cardinality(weekdays)<3 OR (weekdays[1]<>weekdays[3] AND weekdays[2]<>weekdays[3]))
);
