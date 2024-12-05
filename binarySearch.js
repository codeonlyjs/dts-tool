export function binarySearch(sortedArray, compare_items, item) 
{
    let left = 0;
    let right = sortedArray.length - 1;

    while (left <= right) 
    {
        let mid = Math.floor((left + right) / 2);
        let foundVal = sortedArray[mid];

        let compare = compare_items(foundVal, item);

        if (compare == 0) 
            return mid;
        else if (compare < 0) 
            left = mid + 1;
        else
            right = mid - 1; 
    }

    // Not found, return where (convert back to insert position with (-retv-1)
    return -1 - left; 
}

